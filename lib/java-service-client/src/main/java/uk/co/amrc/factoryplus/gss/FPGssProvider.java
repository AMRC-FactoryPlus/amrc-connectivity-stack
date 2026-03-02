/* Factory+ Java client library.
 * GSS helper class.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.gss;

import java.security.PrivilegedAction;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.ServiceConfigurationError;
import java.util.concurrent.Callable;
import java.util.stream.Stream;
import java.util.stream.Collectors;

import java.security.PrivilegedExceptionAction;
import java.security.PrivilegedActionException;
import javax.security.auth.Subject;
import javax.security.auth.callback.*;
import javax.security.auth.login.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.ietf.jgss.*;
import org.json.*;

import uk.co.amrc.factoryplus.client.FPServiceClient;

/** Wrapper around the  Java GSSAPI.
 *
 * This class simplifies some common operations.
 */
public class FPGssProvider {
    private static final Logger log = LoggerFactory.getLogger(FPGssProvider.class);

    GSSManager gss_manager;
    Oid _krb5Mech, _krb5PrincipalNT;

    /** Internal; construct via {@link FPServiceClient}. */
    public FPGssProvider ()
    {
        try {
            _krb5Mech = new Oid("1.2.840.113554.1.2.2");
            _krb5PrincipalNT = new Oid("1.2.840.113554.1.2.2.1");

            gss_manager = GSSManager.getInstance();
        }
        catch (GSSException e) {
            throw new ServiceConfigurationError("Cannot initialise GSSAPI", e);
        }
    }

    public GSSManager getGSSManager () { return gss_manager; }
    public Oid krb5Mech () { return _krb5Mech; }
    public Oid krb5PrincipalNT () { return _krb5PrincipalNT; }

    /** Builds server (acceptor) credentials.
     *
     * The <code>FPGssServer</code> returned from this method will
     * accept GSS client requests directed to any key given in the
     * keytab. The provided SPN is just for information.
     *
     * @param principal The Kerberos principal name to use.
     * @param keytab The path to a keytab file.
     * @return The server credentials.
     */
    public FPGssServer server (String principal, String keytab)
    {
        return new FPGssServer(this, principal, keytab);
    }

    /** Builds client (initiator) creds from a ccache.
     *
     * This assumes a ccache is available in the default location.
     *
     * @return The client credentials.
     */
    public FPGssClient clientWithCcache ()
    {
        return new FPGssClientCcache(this);
    }

    /** Builds client (initiator) creds from a keytab.
     *
     * This performs a new Kerberos login using the keytab.
     *
     * @param principal The principal to use.
     * @param keytab The keytab file to use.
     * @return The client credentials.
     */
    public FPGssClient clientWithKeytab (String principal, String keytab)
    {
        return new FPGssClientKeytab(this, principal, keytab);
    }

    /** Build client creds from username and password.
     *
     * This performs a new Kerberos login.
     *
     * @param username The username to use.
     * @param password The password.
     * @return The client credentials.
     */
    public FPGssClient clientWithPassword (String username, char[] password)
    {
        return new FPGssClientPassword(this, username, password);
    }
}
