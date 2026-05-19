/* ACS Keycloak SPI
 * Production KerberosAuthenticator: JAAS Krb5LoginModule + JGSS.
 *
 * Logs in via JAAS with the configured principal and keytab to obtain a
 * TGT, then caches a GSSCredential built from the resulting Subject.
 * Before every SPNEGO token request the cached credential's remaining
 * lifetime is checked; when it is close to expiry (or any GSSException
 * is raised during context initiation) the credential and Subject are
 * dropped and a fresh JAAS login is performed. This is the same shape
 * lib/java-service-client uses (see FPGssPrincipal).
 *
 * Thread-safety: credential management is synchronized on this.
 * Subject.doAs is itself thread-safe; the wrapping synchronized block
 * just protects the cached references.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.ietf.jgss.GSSContext;
import org.ietf.jgss.GSSCredential;
import org.ietf.jgss.GSSException;
import org.ietf.jgss.GSSManager;
import org.ietf.jgss.GSSName;
import org.ietf.jgss.Oid;

import javax.security.auth.Subject;
import javax.security.auth.login.AppConfigurationEntry;
import javax.security.auth.login.Configuration;
import javax.security.auth.login.LoginContext;
import javax.security.auth.login.LoginException;
import java.net.URI;
import java.security.PrivilegedAction;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

public class JaasKerberosAuthenticator implements KerberosAuthenticator {

    private static final String SPNEGO_OID = "1.3.6.1.5.5.2";
    private static final String JAAS_ENTRY = "factoryplus-spi-client-keytab";

    /* Refresh when the cached TGT has less than this many seconds left.
     * 60s is enough headroom for a slow round-trip to acs-auth without
     * burning a re-login on every call. */
    private static final int MIN_LIFETIME_SECONDS = 60;

    private final String principal;
    private final String keytabPath;

    private Subject subject;
    private GSSCredential creds;

    public JaasKerberosAuthenticator(String principal, String keytabPath) {
        this.principal = principal;
        this.keytabPath = keytabPath;
        /* Eagerly log in so misconfiguration surfaces at SPI bootstrap
         * rather than on the first user login. */
        ensureCreds();
    }

    @SuppressWarnings({"deprecation", "removal"}) // Subject.doAs deprecated in JDK 23+
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
            return doSpnego(hostbasedService);
        }
        catch (GSSException first) {
            /* The cached TGT may have expired or been revoked; drop
             * cached state and try one fresh login before giving up. */
            invalidate();
            try {
                return doSpnego(hostbasedService);
            }
            catch (GSSException retry) {
                throw new FactoryPlusAuthException(
                    "SPNEGO token generation failed for " + hostbasedService
                        + " (after re-login)", retry);
            }
        }
    }

    @SuppressWarnings({"deprecation", "removal"})
    private String doSpnego(String hostbasedService) throws GSSException {
        GSSCredential cred = ensureCreds();
        Subject subj;
        synchronized (this) { subj = this.subject; }

        PrivilegedAction<Object> action = () -> {
            try {
                GSSManager mgr = GSSManager.getInstance();
                Oid spnego = new Oid(SPNEGO_OID);
                GSSName serverName = mgr.createName(hostbasedService,
                    GSSName.NT_HOSTBASED_SERVICE);
                /* Pass the credential explicitly. JGSS then uses our
                 * cached TGT directly and never falls back to default
                 * JAAS lookup (which would otherwise try to prompt). */
                GSSContext ctx = mgr.createContext(serverName, spnego, cred,
                    GSSContext.DEFAULT_LIFETIME);
                try {
                    return Base64.getEncoder().encodeToString(
                        ctx.initSecContext(new byte[0], 0, 0));
                }
                finally {
                    ctx.dispose();
                }
            }
            catch (GSSException e) {
                return e;
            }
        };
        Object result = Subject.doAs(subj, action);
        if (result instanceof GSSException gss) throw gss;
        return (String) result;
    }

    /* Returns a usable GSSCredential, refreshing the underlying JAAS
     * login if the cached credential is missing or about to expire. */
    private synchronized GSSCredential ensureCreds() {
        if (creds != null) {
            int lifetime;
            try {
                lifetime = creds.getRemainingLifetime();
            }
            catch (GSSException e) {
                lifetime = 0;
            }
            if (lifetime >= MIN_LIFETIME_SECONDS) return creds;
            invalidate();
        }

        Subject subj = new Subject();
        try {
            Configuration config = inlineKrb5Config(principal, keytabPath);
            LoginContext ctx = new LoginContext(JAAS_ENTRY, subj, null, config);
            ctx.login();
        }
        catch (LoginException e) {
            throw new FactoryPlusAuthException(
                "Kerberos login failed for " + principal
                    + " with keytab " + keytabPath, e);
        }

        try {
            this.subject = subj;
            this.creds = buildCredential(subj);
            return this.creds;
        }
        catch (GSSException e) {
            invalidate();
            throw new FactoryPlusAuthException(
                "Failed to build GSS credential for " + principal, e);
        }
    }

    @SuppressWarnings({"deprecation", "removal"})
    private static GSSCredential buildCredential(Subject subj) throws GSSException {
        PrivilegedAction<Object> action = () -> {
            try {
                return GSSManager.getInstance()
                    .createCredential(GSSCredential.INITIATE_ONLY);
            }
            catch (GSSException e) {
                return e;
            }
        };
        Object result = Subject.doAs(subj, action);
        if (result instanceof GSSException gss) throw gss;
        return (GSSCredential) result;
    }

    private synchronized void invalidate() {
        if (creds != null) {
            try { creds.dispose(); } catch (GSSException ignored) {}
            creds = null;
        }
        subject = null;
    }

    private static Configuration inlineKrb5Config(String principal, String keytab) {
        return new Configuration() {
            @Override
            public AppConfigurationEntry[] getAppConfigurationEntry(String name) {
                if (!JAAS_ENTRY.equals(name)) return null;
                Map<String, String> opts = new HashMap<>();
                opts.put("doNotPrompt", "true");
                opts.put("storeKey", "false");
                opts.put("isInitiator", "true");
                opts.put("principal", principal);
                opts.put("useKeyTab", "true");
                opts.put("keyTab", keytab);
                return new AppConfigurationEntry[] {
                    new AppConfigurationEntry(
                        "com.sun.security.auth.module.Krb5LoginModule",
                        AppConfigurationEntry.LoginModuleControlFlag.REQUIRED,
                        opts)
                };
            }
        };
    }
}
