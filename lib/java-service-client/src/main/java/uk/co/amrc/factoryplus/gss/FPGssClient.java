/* Factory+ Java client library.
 * GSS principal helper.
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

import uk.co.amrc.factoryplus.client.Attempt;

/** GSS client credentials.
 */
public abstract class FPGssClient extends FPGssPrincipal {
    private static final Logger log = LoggerFactory.getLogger(FPGssServer.class);

    /** Internal, construct via {@link FPGssProvider}. */
    public FPGssClient (FPGssProvider provider)
    {
        super(provider);
    }

    protected int getCredUsage () { return GSSCredential.INITIATE_ONLY; }

    /** Creates a GSS initiator context.
     *
     * The server name is provided as a Kerberos principal name.
     *
     * @param server The server we are communicating with.
     * @return A GSS context.
     */
    public Attempt<GSSContext> createContext (String server)
    {
        return _createContext(server, provider.krb5PrincipalNT());
    }

    /** Creates a GSS initiator context.
     *
     * The server name is a hostbased-service GSS string, i.e. in the
     * form <code>service@host</code>. The realm will be resolved via
     * the Kerberos configuration.
     *
     * @param service The server we are communicating with.
     * @return A GSS context.
     */
    public Attempt<GSSContext> createContextHB (String service)
    {
        return _createContext(service, GSSName.NT_HOSTBASED_SERVICE);
    }

    private Attempt<GSSContext> _createContext (String name, Oid type)
    {
        return withCreds(creds -> {
            GSSManager mgr = provider.getGSSManager();
            Oid mech = provider.krb5Mech();

            GSSName srv_nam = mgr.createName(name, type, mech);

            return mgr.createContext(
                srv_nam, mech, creds, GSSContext.DEFAULT_LIFETIME);
        });
    }
}
