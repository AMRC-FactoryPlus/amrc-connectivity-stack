/*
 * Factory+  metadata database
 * Authentication backend
 * Copyright 2026 University of Sheffield AMRC
 */

/* This is not really part of the DB, but it it model layer. It should
 * be moved into a service-api package eventually. */
package uk.co.amrc.factoryplus.metadb.db;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.regex.Pattern;

/* I'm not sure about having this here, this is model layer */
import jakarta.ws.rs.core.SecurityContext;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.vavr.control.Option;
import io.reactivex.rxjava3.core.Single;

import uk.co.amrc.factoryplus.client.FPServiceClient;

public class AuthProvider
{
    private static final Logger log = LoggerFactory.getLogger(AuthProvider.class);

    private static final Pattern Auth_rx = Pattern.compile(
        "([A-Za-z]+) +([A-Za-z0-9._~+/=-]+)");
    private static final Pattern Basic_rx = Pattern.compile("([^:]+):(.+)");

    private static final long EXPIRY = 3*3600;

    private record Princ (String name) implements Principal
    {
        public String getName () { return name; }
    }

    private record Ctx (Principal principal, String scheme) implements SecurityContext 
    {
        public String getAuthenticationScheme () { return scheme; }
        public Principal getUserPrincipal () { return principal; }
        public boolean isSecure () { return true; }
        public boolean isUserInRole (String role) { return false; }

        public String upn () { return principal().getName(); }
    }

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

    private Map<String, Function<String, Single<String>>> schemes = Map.of(
        "basic",    this::basicAuth,
        "bearer",   this::bearerAuth);

    private ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

    public AuthProvider (FPServiceClient fplus)
    {
        this.fplus = fplus;
    }

    public Single<SecurityContext> authenticate (String auth)
    {
        var auth_m = Auth_rx.matcher(auth);
        if (!auth_m.matches())
            throw new Err.AuthFailed("Bad auth header");

        var scheme = auth_m.group(1).toLowerCase();
        var handler = schemes.get(scheme);
        if (handler == null)
            throw new Err.AuthFailed("Unknown scheme: " + scheme);

        var creds = auth_m.group(2);

        return handler.apply(creds)
            .map(upn -> new Ctx(new Princ(upn), scheme));
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

    private Single<String> basicAuth (String creds)
    {
        var creds_b = b64d.decode(creds);
        var creds_s = new String(creds_b, StandardCharsets.UTF_8);

        var creds_m = Basic_rx.matcher(creds_s);
        if (!creds_m.matches())
            throw new Err.AuthFailed("Bad Basic creds");

        var user = creds_m.group(1);
        var passwd = CharBuffer.wrap(creds_m.group(2));

        return fplus.gss()
            .verifyPassword(user, passwd)
            .map(r -> r.upn());
    }

    private Single<String> bearerAuth (String tok)
    {
        var sess = sessions.get(tok);

        if (sess == null)
            throw new Err.AuthFailed("Bad token");

        /* We may be racing with another thread which is also expiring
         * this token. That doesn't matter as one of us will remove it
         * and both will fail the auth. */
        if (sess.isExpired()) {
            log.info("Expired token {}...", tok.substring(0, 5));
            sessions.remove(tok);
            throw new Err.AuthFailed("Expired token");
        }

        return Single.just(sess.upn());
    }
}
