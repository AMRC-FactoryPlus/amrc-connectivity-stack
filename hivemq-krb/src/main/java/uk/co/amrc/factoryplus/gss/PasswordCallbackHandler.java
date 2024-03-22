/* Factory+ Java client library.
 * Password callback handler.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.gss;

import javax.security.auth.callback.*;

class PasswordCallbackHandler implements CallbackHandler {
    private String username;
    private char[] password;

    public PasswordCallbackHandler (String user, char[] passwd)
    {
        username = user;
        password = passwd;
    }

    public void handle (Callback[] callbacks)
        throws UnsupportedCallbackException
    {
        for (Callback cb : callbacks) {
            if (cb instanceof NameCallback) {
                ((NameCallback)cb).setName(username);
            }
            else if (cb instanceof PasswordCallback) {
                ((PasswordCallback)cb).setPassword(password);
            }
            else {
                throw new UnsupportedCallbackException(cb);
            }
        }
    }
}

