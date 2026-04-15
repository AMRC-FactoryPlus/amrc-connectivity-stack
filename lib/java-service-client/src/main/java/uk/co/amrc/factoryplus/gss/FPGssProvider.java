/* Factory+ Java client library.
 * GSS helper class.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.gss;

import java.security.PrivilegedAction;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
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

import io.reactivex.rxjava3.core.Single;

import uk.co.amrc.factoryplus.client.FPServiceClient;

/** Wrapper around the  Java GSSAPI.
 *
 * This class simplifies some common operations.
 */
public class FPGssProvider {
    private static final Logger log = LoggerFactory.getLogger(FPGssProvider.class);

    FPServiceClient fplus;
    GSSManager gss_manager;
    Oid _krb5Mech, _krb5PrincipalNT;

    /** Internal; construct via {@link FPServiceClient}. */
    public FPGssProvider (FPServiceClient fplus)
    {
        this.fplus = fplus;
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

    private byte[] bbToArray (ByteBuffer buf)
    {
        if (buf.hasArray())
            return buf.array();

        byte[] ary = new byte[buf.limit()];
        buf.get(ary);
        return ary;
    }

    private char[] cbToArray (CharBuffer buf)
    {
        if (buf.hasArray())
            return buf.array();

        char[] ary = new char[buf.limit()];
        buf.get(ary);
        return ary;
    }

    /** Verify a GSSAPI packet.
     * This will not make network calls and will only access disk to
     * read the keytab, so in general may be run syncronously.
     * @param buf The GSSAPI packet from the client.
     * @return A full Kerberos UPN for the user
     */
    public Single<FPGssResult> verifyGSSAPI (ByteBuffer buf)
    {
        var in_buf = bbToArray(buf);
        return fplus.gssServer()
            /* In principle this call blocks on disk. In practice that
             * 'disk' will be a K8s tmpfs and very fast. */
            .createContext()
            .map(ctx -> {
                /* It would be helpful to log the client and server
                 * identities if this call fails, so we can see who was
                 * trying to connect and what endpoint they were trying to
                 * connect to. But get{Src,Targ}Name can't be called until
                 * the context is established, so we can't. Grrr. */
                var out_buf = ctx.acceptSecContext(in_buf, 0, in_buf.length);

                /* We could handle this case, but I don't think with the
                 * Kerberos mech there is ever any need. */
                if (!ctx.isEstablished())
                    throw new Exception("GSS login took more than one step!");

                String upn = ctx.getSrcName().toString();
                log.info("Authenticated client {}", upn);

                return new FPGssResult(upn, ByteBuffer.wrap(out_buf));
            });
    }

    /** Verify a username and password against the KDC.
     * This will get a service ticket to validate the KDC. This method
     * makes network calls, so in general will need to be run
     * asynchronously.
     * @param user The username as supplied
     * @param passwd The password
     * @return A full Kerberos UPN for the user
     */
    public Single<FPGssResult> verifyPassword (String user, CharBuffer passwd)
    {
        var passwd_ary = cbToArray(passwd);
        String srv = fplus.getConf("server_principal");

        /* We need to get and verify a service ticket, to protect
         * against a spoofed KDC. The only striaghtforward way to do
         * this is just to do the whole GSSAPI dance on the client's
         * behalf. */
        return clientWithPassword(user, passwd_ary)
            /* This call will block on network. */
            .createContext(srv)
            .map(ctx -> ByteBuffer.wrap(ctx.initSecContext(new byte[0], 0, 0)))
            .flatMap(this::verifyGSSAPI);
    }
}
