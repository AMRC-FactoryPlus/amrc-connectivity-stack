/*
 * Factory+  metadata database
 * Authentication backend
 * Copyright 2026 University of Sheffield AMRC
 */

/* This is not really part of the DB, but it it model layer. It should
 * be moved into a service-api package eventually. */
package uk.co.amrc.factoryplus.metadb.db;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.regex.Pattern;

/* I'm not sure about having this here, this is model layer */
import jakarta.ws.rs.core.SecurityContext;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.vavr.control.Option;

public class AuthProvider
{
    private static final Logger log = LoggerFactory.getLogger(AuthProvider.class);
    private static final Pattern Basic_rx = Pattern.compile("([^:]+):(.+)");
    private static final long EXPIRY = 3*3600;

    /* XXX Fixed auth for now */
    private static final Map<String, String> passwords = Map.of("bob", "bob");

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

    private SecureRandom rng = new SecureRandom();
    private Base64.Decoder b64d = Base64.getDecoder();
    private Base64.Encoder b64e = Base64.getEncoder();

    private Map<String, Function<String, Option<String>>> schemes = Map.of(
        "basic",    this::basicAuth,
        "bearer",   this::bearerAuth);

    private ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

    public Optional<SecurityContext> authenticate (String scheme, String creds)
    {
        /* XXX Should I just use vavr Option throughout? */
        var lscheme = scheme.toLowerCase();
        return Option.of(schemes.get(lscheme))
            .onEmpty(() -> log.info("Unsupported auth: {}", scheme))
            .flatMap(auth -> auth.apply(creds))
            .peek(upn -> log.info("Authenticated {} via {}", upn, scheme))
            .onEmpty(() -> log.info("Auth failed with {}", scheme))
            .map(upn -> new Ctx(new Princ(upn), lscheme))
            .transform(Option::<SecurityContext>narrow)
            .toJavaOptional();
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

    private Option<String> basicAuth (String creds)
    {
        var creds_b = b64d.decode(creds);
        var creds_s = new String(creds_b, StandardCharsets.UTF_8);

        var creds_m = Basic_rx.matcher(creds_s);
        if (!creds_m.matches()) {
            log.info("Bad Basic creds: {}...", creds_s.substring(0, 6));
            return Option.none();
        }
        var user = creds_m.group(1);
        var passwd = creds_m.group(2);

        return Option.of(passwords.get(user))
            .filter(p -> p.equals(passwd))
            .onEmpty(() -> log.info("Password auth failed for {}", user))
            .map(p -> user);
    }

    private Option<String> bearerAuth (String tok)
    {
        var sess = sessions.get(tok);

        if (sess == null) {
            log.info("Bad token {}...", tok.substring(0, 5));
            return Option.none();
        }

        /* We may be racing with another thread which is also expiring
         * this token. That doesn't matter as one of us will remove it
         * and both will fail the auth. */
        if (sess.isExpired()) {
            log.info("Expired token {}...", tok.substring(0, 5));
            sessions.remove(tok);
            return Option.none();
        }

        return Option.some(sess.upn());
    }
}
