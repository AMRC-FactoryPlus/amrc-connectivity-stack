/* ACS Keycloak SPI
 * Production KerberosAuthenticator: thin sync wrapper around the
 * Factory+ Java service client's FPGssClientKeytab.
 *
 * lib/java-service-client already implements the keytab login,
 * GSSCredential caching, lifetime-aware refresh and retry-on-fault
 * pattern (see FPGssPrincipal._withCreds). We delegate to it rather
 * than duplicating the logic in the SPI - this is the wiring the
 * original "Phase 4" TODOs in the SPI source point at.
 *
 * The lib API is RxJava-based; the SPI surface is plain synchronous
 * method calls. We bridge with Single.blockingGet(). Each SPNEGO
 * token request mints one fresh GSSContext (one-shot SPNEGO), which
 * is correct for the HTTP "Authorization: Negotiate <token>" flow.
 *
 * FPGssProvider's constructor parameter is an FPServiceClient that is
 * only consulted by the verify*() server-side paths (which we never
 * exercise from this SPI), so we pass null. If a future change starts
 * using the verify paths from here it will NPE loudly rather than
 * silently misbehaving.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.ietf.jgss.GSSContext;
import org.ietf.jgss.GSSException;

import java.net.URI;
import java.util.Base64;

import uk.co.amrc.factoryplus.gss.FPGssClient;
import uk.co.amrc.factoryplus.gss.FPGssProvider;

public class JaasKerberosAuthenticator implements KerberosAuthenticator {

    private final FPGssClient client;

    public JaasKerberosAuthenticator(String principal, String keytabPath) {
        FPGssProvider provider = new FPGssProvider(null);
        this.client = provider.clientWithKeytab(principal, keytabPath);
        /* Force the initial JAAS login to happen now so misconfiguration
         * surfaces at SPI bootstrap, not on the first user sign-in. */
        primeCredentials();
    }

    @Override
    public String spnegoTokenFor(URI target) {
        String host = target.getHost();
        if (host == null || host.isBlank()) {
            throw new FactoryPlusAuthException(
                "Cannot derive Kerberos service principal: target URL " + target
                    + " has no host");
        }
        String hostbasedService = "HTTP@" + host;

        try {
            return client.createContextHB(hostbasedService)
                .map(JaasKerberosAuthenticator::oneShotSpnego)
                .blockingGet();
        }
        catch (RuntimeException e) {
            Throwable cause = unwrap(e);
            throw new FactoryPlusAuthException(
                "SPNEGO token generation failed for " + hostbasedService, cause);
        }
    }

    /* Build a SPNEGO initial token from a freshly-created GSSContext.
     * The context is one-shot: Kerberos completes in a single
     * initSecContext call so we never need to round-trip with the
     * server. The context is disposed before we return. */
    private static String oneShotSpnego(GSSContext ctx) throws GSSException {
        try {
            byte[] token = ctx.initSecContext(new byte[0], 0, 0);
            return Base64.getEncoder().encodeToString(token);
        }
        finally {
            ctx.dispose();
        }
    }

    /* Trigger the lib's lazy login at construction time, so a bad
     * principal/keytab fails the SPI bootstrap rather than the first
     * end-user request. We deliberately throw a clear exception type. */
    private void primeCredentials() {
        try {
            client.createContextHB("HTTP@localhost")
                .map(ctx -> { ctx.dispose(); return true; })
                .blockingGet();
        }
        catch (RuntimeException e) {
            /* A successful KDC interaction may still fail to issue a
             * service ticket for HTTP/localhost because no such
             * principal exists - that's fine, we just wanted the TGT.
             * The lib will have cached the GSSCredential by now. Only
             * re-throw if the TGT itself could not be obtained. */
            Throwable cause = unwrap(e);
            if (cause instanceof javax.security.auth.login.LoginException) {
                throw new FactoryPlusAuthException(
                    "Kerberos login failed at SPI bootstrap", cause);
            }
            /* Any GSSException at this stage is downstream of a
             * successful login; swallow. */
        }
    }

    /* The lib wraps checked exceptions inside RuntimeException via
     * RxJava's Exceptions.propagate. Peel the wrapper off so callers
     * see the real Kerberos/GSS cause. */
    private static Throwable unwrap(Throwable t) {
        Throwable cause = t.getCause();
        return cause != null ? cause : t;
    }
}
