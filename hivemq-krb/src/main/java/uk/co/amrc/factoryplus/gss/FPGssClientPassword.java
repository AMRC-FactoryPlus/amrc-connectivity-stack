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

public class FPGssClientPassword extends FPGssClient {
    private String principal;
    private char[] password;

    public FPGssClientPassword (FPGssProvider provider,
        String principal, char[] password)
    {
        super(provider);
        this.principal = principal;
        this.password = password;
    }

    protected LoginContext buildLoginContext (Subject subj)
        throws LoginException
    {
        Configuration config = new KrbConfiguration();
        CallbackHandler cb = new PasswordCallbackHandler(principal, password);
        return new LoginContext("client-password", subj, cb, config);
    }
}
