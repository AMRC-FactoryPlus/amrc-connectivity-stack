/* Factory+ HiveMQ auth plugin.
 * GssAction interface.
 * Copyright 2022 AMRC
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import org.ietf.jgss.*;

interface GssAction {
    public void run ()
        throws GSSException;
}
