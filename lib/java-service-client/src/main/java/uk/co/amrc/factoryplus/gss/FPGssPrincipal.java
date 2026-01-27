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

import io.reactivex.rxjava3.functions.Function;
import io.reactivex.rxjava3.functions.Supplier;

import uk.co.amrc.factoryplus.client.Attempt;

/** A GSS principal (client or server).
 */
public abstract class FPGssPrincipal {
    private static final Logger log = LoggerFactory.getLogger(FPGssServer.class);

    FPGssProvider provider;
    Subject subject;
    GSSCredential creds;

    /** Internal, construct via {@link FPGssProvider}. */
    public FPGssPrincipal (FPGssProvider provider)
    {
        this.provider = provider;
    }

    protected abstract LoginContext buildLoginContext (Subject subj)
        throws LoginException;
    protected abstract int getCredUsage ();

    private Attempt<GSSCredential> getCreds ()
    {
        if (creds != null)
            return Attempt.of(creds);

        return Attempt.ofCallable(() -> {
                if (subject == null) {
                    subject = new Subject();
                    var ctx = this.buildLoginContext(subject);
                    ctx.login();
                }
                return subject;
            })
            .flatMap(s -> withSubject(() -> {
                creds = provider.getGSSManager()
                    .createCredential(getCredUsage());
                return creds;
            }));
    }

    protected synchronized <T> Attempt<T> withCreds (
        Function<GSSCredential,T> callback)
    {
        /* XXX This is a mess. It could probably be redone with a pair
         * of cached Observables to avoid all this stateful tangle. */

        if (creds != null) {
            int lft = Attempt.ofCallable(() -> creds.getRemainingLifetime())
                .orElse(e -> {
                    log.warn("Error fetching GSS lifetime", e);
                    return 0;
                });
            if (lft < 5)
                creds = null;
        }

        return getCreds()
            .handle(GSSException.class, err -> {
                log.info("GSS error, retrying login", err);
                // If we get a GSSException, try logging in again
                creds = null;
                subject = null;
                return getCreds();
            })
            .flatMap(cr -> withSubject(() -> callback.apply(cr)));
    }

    protected <T> Attempt<T> withSubject (Supplier<T> callback)
    {
        PrivilegedAction<Attempt<T>> action = () -> Attempt.ofSupplier(callback);
        return Subject.doAs(subject, action)
            .mapError(PrivilegedActionException.class, err -> err.getCause());
    }
}
