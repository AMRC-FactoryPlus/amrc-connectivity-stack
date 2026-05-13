/* ACS Keycloak SPI
 * Production KerberosAuthenticator: JAAS Krb5LoginModule + JGSS.
 *
 * Logs in once at construction time with the configured principal and
 * keytab; reuses the resulting Subject for every subsequent SPNEGO
 * token generation. JAAS handles ticket renewal under the hood.
 *
 * Thread-safety: each spnegoTokenFor call creates a fresh GSSContext
 * but reuses the immutable Subject; Subject.doAs is thread-safe.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.ietf.jgss.GSSContext;
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

    private final String principal;
    private final String keytabPath;
    private final Subject subject;

    public JaasKerberosAuthenticator(String principal, String keytabPath) {
        this.principal = principal;
        this.keytabPath = keytabPath;
        this.subject = login();
    }

    private Subject login() {
        Configuration config = inlineKrb5Config(principal, keytabPath);
        Subject subj = new Subject();
        try {
            LoginContext ctx = new LoginContext(JAAS_ENTRY, subj, null, config);
            ctx.login();
        }
        catch (LoginException e) {
            throw new FactoryPlusAuthException(
                "Kerberos login failed for " + principal
                    + " with keytab " + keytabPath, e);
        }
        return subj;
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

        PrivilegedAction<String> action = () -> {
            try {
                GSSManager mgr = GSSManager.getInstance();
                Oid spnego = new Oid(SPNEGO_OID);
                GSSName serverName = mgr.createName(hostbasedService,
                    GSSName.NT_HOSTBASED_SERVICE);
                GSSContext ctx = mgr.createContext(serverName, spnego, null,
                    GSSContext.DEFAULT_LIFETIME);
                try {
                    byte[] token = ctx.initSecContext(new byte[0], 0, 0);
                    return Base64.getEncoder().encodeToString(token);
                }
                finally {
                    ctx.dispose();
                }
            }
            catch (GSSException e) {
                throw new FactoryPlusAuthException(
                    "SPNEGO token generation failed for " + hostbasedService, e);
            }
        };
        return Subject.doAs(subject, action);
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
