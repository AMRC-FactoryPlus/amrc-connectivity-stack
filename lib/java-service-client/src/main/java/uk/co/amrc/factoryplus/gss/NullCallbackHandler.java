/* Factory+ Java client library.
 * Null callback handler class.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.gss;

import javax.security.auth.callback.*;

class NullCallbackHandler implements CallbackHandler {
    public void handle (Callback[] callbacks) 
        throws UnsupportedCallbackException
    {
        throw new UnsupportedCallbackException(callbacks[0]);
    }
}

