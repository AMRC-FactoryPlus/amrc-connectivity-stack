/* Factory+ HiveMQ auth plugin.
 * Kerberos LoginContext configuration.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import java.util.HashMap;
import java.util.ServiceConfigurationError;

import javax.security.auth.Subject;
import javax.security.auth.callback.*;
import javax.security.auth.login.*;

class KrbConfiguration extends Configuration {
    private String keytab;
    private String principal;

    public KrbConfiguration (String keytab)
    {
        this.keytab = keytab;
    }

    public AppConfigurationEntry[] getAppConfigurationEntry(String name)
    {
        HashMap<String,String> opts = new HashMap();

        if (name == "hivemq") {

            opts.put("doNotPrompt", "true");
            opts.put("useKeyTab", "true");
            opts.put("keyTab", keytab);
            opts.put("storeKey", "true");
            opts.put("isInitiator", "false");
            opts.put("principal", "*");
        }
        else if (name == "hivemq-password") {
            opts.put("doNotPrompt", "false");
            opts.put("storeKey", "true");
            opts.put("isInitiator", "true");
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

