/* Factory+ HiveMQ auth plugin.
 * Kerberos LoginContext configuration.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.gss;

import java.util.HashMap;
import java.util.ServiceConfigurationError;

import javax.security.auth.Subject;
import javax.security.auth.callback.*;
import javax.security.auth.login.*;

class KrbConfiguration extends Configuration {
    private String keytab;
    private String principal;

    public KrbConfiguration (String principal, String keytab)
    {
        this.keytab = keytab;
        this.principal = principal;
    }

    public KrbConfiguration () { }

    public AppConfigurationEntry[] getAppConfigurationEntry(String name)
    {
        HashMap<String,String> opts = new HashMap();

        switch (name) {
        case "server":
            opts.put("doNotPrompt", "true");
            opts.put("useKeyTab", "true");
            opts.put("keyTab", keytab);
            opts.put("storeKey", "true");
            opts.put("isInitiator", "false");
            opts.put("principal", principal);
            break;

        case "client-password":
            opts.put("doNotPrompt", "false");
            opts.put("storeKey", "true");
            opts.put("isInitiator", "true");
            break;

        case "client-ccache":
            opts.put("doNotPrompt", "true");
            opts.put("storeKey", "false");
            opts.put("isInitiator", "true");
            opts.put("useTicketCache", "true");
            break;

        default:
            return null;
        }

        AppConfigurationEntry[] rv = {
            new AppConfigurationEntry(
                "com.sun.security.auth.module.Krb5LoginModule",
                AppConfigurationEntry.LoginModuleControlFlag.REQUIRED,
                opts),
        };
        return rv;
    }
}

