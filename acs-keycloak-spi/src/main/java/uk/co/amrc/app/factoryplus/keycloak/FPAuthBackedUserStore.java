/* ACS Keycloak SPI
 * HTTP-backed FactoryPlusUserStore implementation.
 *
 * Uses bare java.net.http.HttpClient against the Factory+ auth service
 * over its existing v2 identity API. No Kerberos here - that's Phase 4,
 * which will swap this out (or extend it) to use lib/java-service-client's
 * FPGssClientKeytab for SPNEGO authentication. The interface seam
 * (FactoryPlusUserStore) absorbs that change without touching the
 * provider.
 *
 * JSON parsing uses Jackson (which Keycloak ships in its runtime
 * classpath) rather than org.json so we don't have to bundle a JSON
 * library into the SPI jar.
 *
 * F+ identity model recap:
 *   * Principals are UUIDs with 0+ identities (kind, name)
 *   * Today only kind="kerberos" exists; name is the full UPN
 *     (e.g. "alice@FACTORYPLUS.LOCAL")
 *   * F+ does not store email addresses
 *   * Status 410 ("Gone") is the "doesn't exist" code, not 404
 *
 * HTTP contract (existing acs-auth v2 endpoints, no changes needed):
 *
 *   GET /v2/principal/{uuid}
 *       200 with { uuid, kerberos: "alice@..." } when the principal exists
 *       410 when no principal has that UUID
 *
 *   GET /v2/identity/kerberos/{upn}
 *       200 with the UUID string (NOT JSON object) when the UPN matches
 *       410 when no identity has that UPN
 *
 * findByUsername therefore costs two HTTP calls (identity lookup, then
 * principal lookup). Login is rare; Phase 5 adds caching to fold both
 * into a single warm path.
 *
 * findByEmail always returns Optional.empty() because F+ has no email
 * field. Reserving the FactoryPlusUser.email DTO field for future use
 * if F+ ever stores email.
 *
 * Any 5xx, malformed JSON, or transport failure is surfaced as
 * FactoryPlusAuthException so Keycloak can fall through to the next
 * federation rather than silently treating the failure as "user not
 * found".
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;

public class FPAuthBackedUserStore implements FactoryPlusUserStore {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String IDENTITY_KIND_KERBEROS = "kerberos";

    private final URI baseUrl;
    private final Duration timeout;
    private final HttpClient http;
    private final KerberosAuthenticator authenticator;
    private final String defaultRealm;

    /** No-auth constructor; useful for unauthenticated test setups
     *  (Wiremock fixtures, etc). */
    public FPAuthBackedUserStore(URI baseUrl, Duration timeout) {
        this(baseUrl, timeout, null, null);
    }

    /** Authenticated constructor without a default realm; equivalent
     *  to passing {@code null} for {@code defaultRealm}. Inputs without
     *  an {@code @realm} suffix are passed to F+ verbatim. */
    public FPAuthBackedUserStore(URI baseUrl, Duration timeout,
                                 KerberosAuthenticator authenticator) {
        this(baseUrl, timeout, authenticator, null);
    }

    /** Production constructor. When {@code authenticator} is non-null
     *  every request gets {@code Authorization: Negotiate <token>}
     *  derived from it. When {@code defaultRealm} is non-blank, a
     *  {@code findByUsername} call with no {@code @realm} suffix has
     *  {@code @<defaultRealm>} appended before the F+ lookup, letting
     *  local users log in with their short name. Inputs that already
     *  contain {@code @} are passed through verbatim, preserving
     *  cross-realm logins. */
    public FPAuthBackedUserStore(URI baseUrl, Duration timeout,
                                 KerberosAuthenticator authenticator,
                                 String defaultRealm) {
        this.baseUrl = baseUrl;
        this.timeout = timeout;
        this.authenticator = authenticator;
        this.defaultRealm = (defaultRealm == null || defaultRealm.isBlank())
            ? null : defaultRealm.trim();
        // Pin HTTP/1.1: Java's default tries an h2c upgrade on plaintext
        // connections (sends Upgrade: h2c + Connection: Upgrade). Node's
        // HTTP parser rejects that with 400 "Invalid Upgrade header".
        this.http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(timeout)
            .build();
    }

    @Override
    public Optional<FactoryPlusUser> findByUuid(String uuid) {
        return fetchPrincipal(uuid);
    }

    @Override
    public Optional<FactoryPlusUser> findByUsername(String username) {
        String upn = applyDefaultRealm(username);
        return fetchUuidByIdentity(IDENTITY_KIND_KERBEROS, upn)
            .flatMap(this::fetchPrincipal);
    }

    /** Short names get {@code @<defaultRealm>} appended so local users
     *  can log in with just their username. Inputs that already
     *  contain {@code @} (and the default realm itself) are used
     *  verbatim - the SPI does not force any case normalisation,
     *  since while uppercase Kerberos realms are convention, not
     *  every deployment follows it and case-folding inputs would
     *  break lookups against F+ entries that don't match the forced
     *  casing. */
    private String applyDefaultRealm(String username) {
        if (username == null) return null;
        if (username.contains("@")) return username;
        if (defaultRealm == null) return username;
        return username + "@" + defaultRealm;
    }

    @Override
    public Optional<FactoryPlusUser> findByEmail(String email) {
        // F+ has no email field; this lookup is unsupported and always
        // returns empty. Reserved for a future F+ schema extension.
        return Optional.empty();
    }

    @Override
    public Set<String> findPermissionsForPrincipal(String uuid) {
        return fetchWildcardPermissions(uuid);
    }

    /** GET /v2/identity/{kind}/{name} -> UUID string, or empty on 410. */
    private Optional<String> fetchUuidByIdentity(String kind, String name) {
        URI uri = baseUrl.resolve("/v2/identity/" + encode(kind) + "/" + encode(name));
        HttpResponse<String> res = sendGet(uri);
        if (isNotFound(res.statusCode())) return Optional.empty();
        requireSuccess(res, uri);

        try {
            JsonNode node = MAPPER.readTree(res.body());
            if (!node.isTextual()) {
                throw new FactoryPlusAuthException(
                    "Expected UUID string from " + uri + ", got: " + res.body());
            }
            return Optional.of(node.asText());
        }
        catch (JsonProcessingException e) {
            throw new FactoryPlusAuthException("Malformed response from " + uri, e);
        }
    }

    /** All-zero UUID = F+ Wildcard target. Permissions granted on this
     *  target are global ("any object"), the analogue of a role. */
    private static final String WILDCARD_TARGET =
        "00000000-0000-0000-0000-000000000000";

    /** GET /v2/acl/{uuid} -> [{permission, target, plural?}, ...].
     *  Filters to entries with target=Wildcard and returns the unique
     *  set of permission UUIDs. Empty on 410/404 (principal absent or
     *  caller cannot read any of its grants). */
    private Set<String> fetchWildcardPermissions(String uuid) {
        URI uri = baseUrl.resolve("/v2/acl/" + encode(uuid));
        HttpResponse<String> res = sendGet(uri);
        if (isNotFound(res.statusCode())) return Set.of();
        requireSuccess(res, uri);

        try {
            JsonNode root = MAPPER.readTree(res.body());
            if (!root.isArray()) {
                throw new FactoryPlusAuthException(
                    "Expected JSON array of ACL entries from " + uri
                        + ", got: " + res.body());
            }
            Set<String> out = new HashSet<>();
            for (JsonNode entry : root) {
                JsonNode perm = entry.get("permission");
                JsonNode targ = entry.get("target");
                if (perm == null || !perm.isTextual()) continue;
                if (targ == null || !targ.isTextual()) continue;
                if (!WILDCARD_TARGET.equals(targ.asText())) continue;
                out.add(perm.asText());
            }
            return Set.copyOf(out);
        }
        catch (JsonProcessingException e) {
            throw new FactoryPlusAuthException(
                "Malformed response from " + uri, e);
        }
    }

    /** GET /v2/principal/{uuid} -> {uuid, kerberos: "..."}, or empty on 410. */
    private Optional<FactoryPlusUser> fetchPrincipal(String uuid) {
        URI uri = baseUrl.resolve("/v2/principal/" + encode(uuid));
        HttpResponse<String> res = sendGet(uri);
        if (isNotFound(res.statusCode())) return Optional.empty();
        requireSuccess(res, uri);

        try {
            JsonNode root = MAPPER.readTree(res.body());
            if (!root.isObject() || !root.hasNonNull("uuid")) {
                throw new FactoryPlusAuthException(
                    "Malformed principal response from " + uri
                        + " (missing uuid field)");
            }
            JsonNode kerberosNode = root.get(IDENTITY_KIND_KERBEROS);
            if (kerberosNode == null || kerberosNode.isNull()) {
                // Principal exists but has no Kerberos identity. We
                // can't surface it as a Keycloak user without a
                // username, so treat as not-found from the SPI's
                // perspective rather than NPE later.
                return Optional.empty();
            }
            return Optional.of(new FactoryPlusUser(
                root.get("uuid").asText(),
                kerberosNode.asText(),
                null /* F+ has no email */));
        }
        catch (JsonProcessingException e) {
            throw new FactoryPlusAuthException(
                "Malformed response from " + uri, e);
        }
    }

    private HttpResponse<String> sendGet(URI uri) {
        // Fresh HttpClient (and therefore fresh TCP socket) per
        // request. The F+ auth Node HTTP server's idle keep-alive
        // timeout (~5s) is shorter than the JDK HttpClient's default
        // (1200s), so a shared client racing the server eventually
        // reuses a half-dead socket and the SPI lookup fails with
        // "received no bytes" after Keycloak's 3s storage timeout.
        // Login traffic is sparse enough that the per-call client
        // overhead is negligible.
        HttpClient oneShot = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(timeout)
            .build();
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
            .timeout(timeout)
            .header("Accept", "application/json")
            .GET();
        if (authenticator != null) {
            builder.header("Authorization", "Negotiate " + authenticator.spnegoTokenFor(uri));
        }
        HttpRequest req = builder.build();
        try {
            return oneShot.send(req, HttpResponse.BodyHandlers.ofString());
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new FactoryPlusAuthException("Interrupted calling " + uri, e);
        }
        catch (IOException e) {
            throw new FactoryPlusAuthException("Transport failure calling " + uri, e);
        }
    }

    /** F+ uses 410 for "doesn't exist". Some clients/proxies may also
     *  surface 404; accept both for resilience. */
    private static boolean isNotFound(int status) {
        return status == 410 || status == 404;
    }

    private static void requireSuccess(HttpResponse<String> res, URI uri) {
        int status = res.statusCode();
        if (status < 200 || status >= 300) {
            String body = res.body();
            if (body != null && body.length() > 500)
                body = body.substring(0, 500) + "...[truncated]";
            throw new FactoryPlusAuthException(
                "F+ auth returned " + status + " for " + uri
                    + " body=" + body);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
