/* Factory+ HiveMQ auth plugin.
 * Keycloak JWT verification.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import java.net.URL;
import java.util.Set;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.json.JSONObject;
import org.json.JSONTokener;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;

/* Verifies Keycloak-issued JWTs presented as MQTT passwords, mirroring
 * lib/js-service-api's JwtVerifier for the HTTP services. Configured
 * from OIDC_DISCOVERY_URL; when that is unset JWT auth is disabled and
 * passwords go to Kerberos as before.
 *
 * The discovery document is fetched lazily on first use so the broker
 * still starts when Keycloak is down; nimbus's remote JWK source
 * handles JWKS caching and refresh (including on unknown kid, which
 * covers Keycloak key rotation). */
public class FPJwtVerifier
{
    private static final Logger log = LoggerFactory.getLogger(FPJwtVerifier.class);

    /* Deliberately identical in spirit to looks_like_jwt in
     * js-service-api: three dot-separated base64url sections. Opaque
     * F+ tokens are plain base64 so never match. */
    private static final Pattern JWT_RX = Pattern.compile(
        "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$");

    private final String discovery_url;
    private ConfigurableJWTProcessor<SecurityContext> processor;

    public FPJwtVerifier (String discovery_url)
    {
        this.discovery_url =
            discovery_url == null || discovery_url.isBlank()
                ? null : discovery_url;
    }

    public boolean enabled ()
    {
        return discovery_url != null;
    }

    public static boolean looksLikeJwt (CharSequence creds)
    {
        return JWT_RX.matcher(creds).matches();
    }

    /* Verify signature, expiry and issuer, and return the Factory+
     * principal. Prefer the fp_principal_uuid claim: it is stamped on
     * every token our realm issues (federated users live, service
     * accounts via the attribute service-setup stamps) and is the only
     * identity a service account has - its preferred_username is a
     * Keycloak-local name F+ Auth has never heard of. Fall back to the
     * kerberos UPN for tokens from before the mapper existed. Makes
     * network calls (discovery, JWKS); run on a worker thread. */
    public String verify (String token) throws Exception
    {
        JWTClaimsSet claims = processor().process(token, null);
        String uuid = claims.getStringClaim("fp_principal_uuid");
        String upn = claims.getStringClaim("preferred_username");

        if (uuid != null && !uuid.isBlank()) {
            log.info("JWT verified for {} ({})", upn, uuid);
            return uuid;
        }
        if (upn == null || upn.isBlank())
            throw new SecurityException(
                "JWT has neither fp_principal_uuid nor preferred_username");
        return upn;
    }

    private synchronized ConfigurableJWTProcessor<SecurityContext> processor ()
        throws Exception
    {
        if (processor != null)
            return processor;

        log.info("Fetching OIDC discovery document from {}", discovery_url);
        JSONObject disco;
        try (var body = new URL(discovery_url).openStream()) {
            disco = new JSONObject(new JSONTokener(body));
        }
        String issuer = disco.getString("issuer");
        URL jwks_uri = new URL(disco.getString("jwks_uri"));

        JWKSource<SecurityContext> keys = JWKSourceBuilder
            .create(jwks_uri)
            .retrying(true)
            .build();

        var proc = new DefaultJWTProcessor<SecurityContext>();
        proc.setJWSKeySelector(
            new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keys));
        /* Identity claims (fp_principal_uuid / preferred_username) are
         * checked in verify(): which are present varies by grant type
         * (service-account tokens may lack preferred_username). */
        proc.setJWTClaimsSetVerifier(new DefaultJWTClaimsVerifier<>(
            new JWTClaimsSet.Builder().issuer(issuer).build(),
            Set.of("exp")));

        processor = proc;
        return processor;
    }
}
