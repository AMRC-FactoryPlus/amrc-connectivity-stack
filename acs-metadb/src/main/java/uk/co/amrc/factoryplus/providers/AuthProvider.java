/*
 * Factory+  metadata database
 * Authentication backend
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.providers;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;

import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.reactivex.rxjava3.core.*;
import io.vavr.control.Option;

import uk.co.amrc.factoryplus.client.FPServiceClient;
import uk.co.amrc.factoryplus.gss.FPGssResult;
import uk.co.amrc.factoryplus.service.SvcErr;

public class AuthProvider
{
    private static final Logger log = LoggerFactory.getLogger(AuthProvider.class);

    private static final Pattern Auth_rx = Pattern.compile(
        "([A-Za-z]+) +([A-Za-z0-9._~+/=-]+)");
    private static final Pattern Basic_rx = Pattern.compile("([^:]+):(.+)");

    private static final long EXPIRY = 3*3600;

    public record Session (String token, String upn, Instant expiry)
    {
        public boolean isExpired ()
        {
            return Instant.now().isAfter(expiry);
        }
    }

    private FPServiceClient fplus;

    private SecureRandom rng = new SecureRandom();
    private Base64.Decoder b64d = Base64.getDecoder();
    private Base64.Encoder b64e = Base64.getEncoder();

    private Map<String, Function<String, Single<FPGssResult>>> schemes = Map.of(
        "negotiate",    this::gssapiAuth,
        "basic",        this::basicAuth,
        "bearer",       this::bearerAuth);

    private ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

    public AuthProvider (FPServiceClient fplus)
    {
        this.fplus = fplus;
    }

    public FPServiceClient fplus () { return fplus; }
    public Base64.Encoder b64e () { return b64e; }

    public void start ()
    {
        Observable.interval(6, TimeUnit.HOURS)
            .subscribe(v -> {
                log.info("Expiring old sessions");
                sessions.forEach(Long.MAX_VALUE,
                    (tok, sess) -> {
                        if (sess.isExpired())
                            sessions.remove(tok);
                    });
            });
    }

    public Single<FPSecurityContext> authenticate (String auth)
    {
        if (auth == null)
            throw new SvcErr.AuthFailed("No auth supplied");

        var auth_m = Auth_rx.matcher(auth);
        if (!auth_m.matches())
            throw new SvcErr.AuthFailed("Bad auth header");

        var scheme = auth_m.group(1).toLowerCase();
        var handler = schemes.get(scheme);
        if (handler == null)
            throw new SvcErr.AuthFailed("Unknown scheme: " + scheme);

        var creds = auth_m.group(2);

        return handler.apply(creds)
            .doOnSuccess(r -> log.info("Authenticated {} using {}", r.upn(), scheme))
            .map(r -> new FPSecurityContext(scheme, r))
            .onErrorResumeNext(e -> {
                if (e instanceof SvcErr.AuthFailed)
                    return Single.error(e);
                log.info("Authentication failed ({}): {}", scheme, e.toString());
                return Single.error(new SvcErr.AuthFailed("Authentication failure"));
            });
    }

    public Session newSession (String upn)
    {
        var rand = new byte[66];
        rng.nextBytes(rand);
        var token = b64e.encodeToString(rand);

        var sess = new Session(token, upn, Instant.now().plusSeconds(EXPIRY));
        sessions.put(token, sess);

        return sess;
    }

    public Single<FPGssResult> gssapiAuth (String creds)
    {
        return Single.just(creds)
            .map(b64d::decode)
            .map(ByteBuffer::wrap)
            .flatMap(fplus.gss()::verifyGSSAPI);
    }

    public Single<FPGssResult> basicAuth (String creds)
    {
        return Single.just(creds)
            .map(b64d::decode)
            .map(buf -> new String(buf, StandardCharsets.UTF_8))
            .map(Basic_rx::matcher)
            .flatMap(m -> m.matches() ? Single.just(m)
                : Single.error(new SvcErr.AuthFailed("Bad Basic creds")))
            .flatMap(m -> fplus.gss()
                .verifyPassword(m.group(1), CharBuffer.wrap(m.group(2))));
    }

    public Single<FPGssResult> bearerAuth (String tok)
    {
        return Single.defer(() -> {
            var sess = sessions.get(tok);

            if (sess == null)
                return Single.error(new SvcErr.AuthFailed("Bad token"));

            /* We may be racing with another thread which is also expiring
             * this token. That doesn't matter as one of us will remove it
             * and both will fail the auth. */
            if (sess.isExpired()) {
                log.info("Expired token {}...", tok.substring(0, 5));
                sessions.remove(tok);
                return Single.error(new SvcErr.AuthFailed("Expired token"));
            }

            return Single.just(sess.upn());
        })
            .map(upn -> new FPGssResult(upn, Option.none()));
    }
}
