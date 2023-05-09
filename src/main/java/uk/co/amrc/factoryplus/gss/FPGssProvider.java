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

import uk.co.amrc.factoryplus.FPServiceClient;

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

    public Optional<Subject> buildSubject (
        String type, CallbackHandler cb, Configuration config
    ) {
        Subject subj = new Subject();

        try {
            LoginContext ctx = new LoginContext(type, subj, cb, config);
            ctx.login();
            return Optional.of(subj);
        }
        catch (LoginException e) {
            log.error("Krb5 init failed: {}", e.toString());
            return Optional.<Subject>empty();
        }
    }

    public Optional<Subject> buildServerSubject (String keytab, String principal)
    {
        Configuration config = new KrbConfiguration(principal, keytab);
        CallbackHandler cb = new NullCallbackHandler();
        return buildSubject("server", cb, config);
    }

    public Optional<Subject> buildClientSubjectWithCcache ()
    {
        Configuration config = new KrbConfiguration();
        CallbackHandler cb = new NullCallbackHandler();
        return buildSubject("client-ccache", cb, config);
    }

    public Optional<Subject> buildClientSubjectWithPassword (
        char[] password, String principal
    ) {
        Configuration config = new KrbConfiguration();
        CallbackHandler cb = new PasswordCallbackHandler(principal, password);
        return buildSubject("client-password", cb, config);
    }

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
    public Optional<FPGssServer> server (String principal, String keytab)
    {
        return buildServerSubject(keytab, "*")
            .map(subj -> new FPGssServer(this, principal, subj));
    }

    /** Builds client (initiator) creds from a ccache.
     *
     * This assumes a ccache is available in the default location.
     *
     * @return The client credentials.
     */
    public Optional<FPGssClient> clientWithCcache ()
    {
        return buildClientSubjectWithCcache()
            .map(subj -> new FPGssClient(this, subj));
    }

    /** Build client creds from username and password.
     *
     * This performs a new Kerberos login.
     *
     * @param username The username to use.
     * @param password The password.
     * @return The client credentials.
     */
    public Optional<FPGssClient> clientWithPassword (
        String username, char[] password)
    {
        return buildClientSubjectWithPassword(password, username)
            .map(subj -> new FPGssClient(this, subj));
    }
}
