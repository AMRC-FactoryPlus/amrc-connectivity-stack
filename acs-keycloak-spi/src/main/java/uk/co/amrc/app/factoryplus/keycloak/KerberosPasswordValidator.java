/* ACS Keycloak SPI
 * Validates a username/password pair by attempting a Krb5LoginModule
 * login as that principal against the realm KDC. A successful login
 * means the KDC accepted the password; a LoginException means the
 * password was wrong (or the account is locked, expired, etc).
 *
 * This is the "password" half of the SPI auth story; SPNEGO covers the
 * keytab/ticket half via JaasKerberosAuthenticator.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import javax.security.auth.Subject;
import javax.security.auth.callback.Callback;
import javax.security.auth.callback.CallbackHandler;
import javax.security.auth.callback.NameCallback;
import javax.security.auth.callback.PasswordCallback;
import javax.security.auth.callback.UnsupportedCallbackException;
import javax.security.auth.login.AppConfigurationEntry;
import javax.security.auth.login.Configuration;
import javax.security.auth.login.LoginContext;
import javax.security.auth.login.LoginException;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

public class KerberosPasswordValidator {

    private static final String JAAS_ENTRY = "factoryplus-spi-password";

    public boolean validate(String upn, String password) {
        if (upn == null || upn.isBlank() || password == null || password.isEmpty())
            return false;

        // Same realm-uppercase canonicalisation as the user lookup;
        // KDC rejects lowercase realm.
        int at = upn.lastIndexOf('@');
        if (at >= 0) {
            upn = upn.substring(0, at) + "@" + upn.substring(at + 1).toUpperCase();
        }

        Configuration config = inlineConfig();
        CallbackHandler cbh = new UpnPasswordCallbackHandler(upn, password);
        try {
            LoginContext ctx = new LoginContext(
                JAAS_ENTRY, new Subject(), cbh, config);
            ctx.login();
            ctx.logout();
            return true;
        }
        catch (LoginException e) {
            // Expected on bad password / unknown principal / KDC reject.
            return false;
        }
    }

    private static Configuration inlineConfig() {
        return new Configuration() {
            @Override
            public AppConfigurationEntry[] getAppConfigurationEntry(String name) {
                if (!JAAS_ENTRY.equals(name)) return null;
                Map<String, String> opts = new HashMap<>();
                // Initiator login (the user logging in to Keycloak); no
                // keytab, password supplied via CallbackHandler.
                opts.put("useKeyTab", "false");
                opts.put("storeKey", "false");
                opts.put("doNotPrompt", "false");
                opts.put("isInitiator", "true");
                opts.put("refreshKrb5Config", "true");
                return new AppConfigurationEntry[] {
                    new AppConfigurationEntry(
                        "com.sun.security.auth.module.Krb5LoginModule",
                        AppConfigurationEntry.LoginModuleControlFlag.REQUIRED,
                        opts)
                };
            }
        };
    }

    private static final class UpnPasswordCallbackHandler implements CallbackHandler {
        private final String upn;
        private final char[] password;

        UpnPasswordCallbackHandler(String upn, String password) {
            this.upn = upn;
            this.password = password.toCharArray();
        }

        @Override
        public void handle(Callback[] callbacks)
                throws IOException, UnsupportedCallbackException {
            for (Callback cb : callbacks) {
                if (cb instanceof NameCallback nc) {
                    nc.setName(upn);
                }
                else if (cb instanceof PasswordCallback pc) {
                    pc.setPassword(password);
                }
                else {
                    throw new UnsupportedCallbackException(cb);
                }
            }
        }
    }
}
