/* Factory+ Java client library.
 * GSS client with ccache.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.gss;

import javax.security.auth.Subject;
import javax.security.auth.callback.*;
import javax.security.auth.login.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class FPGssClientKeytab extends FPGssClient {
    private String principal;
    private String keytab;

    public FPGssClientKeytab (FPGssProvider provider,
        String principal, String keytab)
    {
        super(provider);
        this.principal = principal;
        this.keytab = keytab;
    }

    protected LoginContext buildLoginContext (Subject subj)
        throws LoginException
    {
        Configuration config = new KrbConfiguration(principal, keytab);
        CallbackHandler cb = new NullCallbackHandler();
        return new LoginContext("client-keytab", subj, cb, config);
    }
}
