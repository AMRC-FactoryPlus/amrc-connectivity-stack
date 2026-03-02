/* Factory+ Java client library.
 * GSS principal helper.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.gss;

import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.ServiceConfigurationError;
import java.util.concurrent.Callable;
import java.util.stream.Stream;
import java.util.stream.Collectors;

import javax.security.auth.Subject;
import javax.security.auth.callback.*;
import javax.security.auth.login.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.ietf.jgss.*;
import org.json.*;

import uk.co.amrc.factoryplus.client.Attempt;

public class FPGssServer extends FPGssPrincipal {
    private static final Logger log = LoggerFactory.getLogger(FPGssServer.class);

    String principal;
    String keytab;

    /** Internal; construct via {@link FPGssProvider}. */
    public FPGssServer (FPGssProvider provider, String principal, String keytab)
    {
        super(provider);
        this.principal = principal;
        this.keytab = keytab;
    }

    protected int getCredUsage () { return GSSCredential.ACCEPT_ONLY; }

    public String getPrincipal () { return principal; }

    protected LoginContext buildLoginContext (Subject subject)
        throws LoginException
    {
        Configuration config = new KrbConfiguration(principal, keytab);
        CallbackHandler cb = new NullCallbackHandler();
        log.info("Creating server context: {}, {}", principal, keytab);
        return new LoginContext("server", subject, cb, config);
    }

    /** Creates a GSS context.
     *
     * @return A new GSS acceptor context.
     */
    public Attempt<GSSContext> createContext ()
    {
        return withCreds(creds -> {
            var krb5 = provider.krb5Mech();
            log.info("Server creds: {}", creds.getName(krb5));
            return provider.getGSSManager().createContext(creds);
        });
    }
}
