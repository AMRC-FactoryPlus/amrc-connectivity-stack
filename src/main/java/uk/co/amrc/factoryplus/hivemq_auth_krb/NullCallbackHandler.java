/* Factory+ HiveMQ auth plugin.
 * Null callback handler class.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import javax.security.auth.callback.*;

class NullCallbackHandler implements CallbackHandler {
    public void handle (Callback[] callbacks) 
        throws UnsupportedCallbackException
    {
        throw new UnsupportedCallbackException(callbacks[0]);
    }
}

