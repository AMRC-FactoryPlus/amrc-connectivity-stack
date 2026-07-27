/* ACS Keycloak SPI
 * HTTP-backed FactoryPlusUserStore implementation.
 *
 * Uses bare java.net.http.HttpClient against the Factory+ auth service
 * over its existing v2 identity API. No Kerberos here - that's Phase 4,
 * which will swap this out (or extend it) to use lib/java-service-client's
 * FPGssClientKeytab for SPNEGO authentication. The interface seam
 * (FactoryPlusUserStore) absorbs that change without touching the
 * provider.
 *
 * JSON parsing uses Jackson (which Keycloak ships in its runtime
 * classpath) rather than org.json so we don't have to bundle a JSON
 * library into the SPI jar.
 *
 * F+ identity model recap:
 *   * Principals are UUIDs with 0+ identities (kind, name)
 *   * Today only kind="kerberos" exists; name is the full UPN
 *     (e.g. "alice@FACTORYPLUS.LOCAL")
 *   * F+ does not store email addresses
 *   * Status 410 ("Gone") is the "doesn't exist" code, not 404
 *
 * HTTP contract (existing acs-auth v2 endpoints, no changes needed):
 *
 *   GET /v2/principal/{uuid}
 *       200 with { uuid, kerberos: "alice@..." } when the principal exists
 *       410 when no principal has that UUID
 *
 *   GET /v2/identity/kerberos/{upn}
 *       200 with the UUID string (NOT JSON object) when the UPN matches
 *       410 when no identity has that UPN
 *
 *   PUT /v2/principal/{uuid}/kerberos    (cross-realm admit only)
 *       body is the UPN as a JSON string; guarded by WriteKrb on the
 *       target UUID. Creates the local principal if absent.
 *
 * findByUsername therefore costs two HTTP calls (identity lookup, then
 * principal lookup). Login is rare; Phase 5 adds caching to fold both
 * into a single warm path.
 *
 * findByEmail always returns Optional.empty() because F+ has no email
 * field. Reserving the FactoryPlusUser.email DTO field for future use
 * if F+ ever stores email.
 *
 * Any 5xx, malformed JSON, or transport failure is surfaced as
 * FactoryPlusAuthException so Keycloak can fall through to the next
 * federation rather than silently treating the failure as "user not
 * found".
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

public class FPAuthBackedUserStore implements FactoryPlusUserStore {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String IDENTITY_KIND_KERBEROS = "kerberos";

    private final URI baseUrl;
    private final Duration timeout;
    private final HttpClient http;
    private final KerberosAuthenticator authenticator;
    private final String defaultRealm;
    /** Realms (upper-cased) we accept cross-realm logins from. Empty by
     *  default, which makes the whole cross-realm path inert. */
    private final Set<String> trustedRealms;
    /** Home-cluster stores, keyed by upper-cased realm. Built once at
     *  construction: each one does a JAAS login through the shared
     *  authenticator, so building per request would blow Keycloak's
     *  storage-lookup budget. A trusted realm with no entry here takes
     *  the mint-fresh path. */
    private final Map<String, FactoryPlusUserStore> homeStores;
    /** Same keys as {@link #homeStores}, kept so error messages can
     *  name the cluster that refused us. */
    private final Map<String, URI> homeAuthUrls;

    /** No-auth constructor; useful for unauthenticated test setups
     *  (Wiremock fixtures, etc). */
    public FPAuthBackedUserStore(URI baseUrl, Duration timeout) {
        this(baseUrl, timeout, null, null);
    }

    /** Authenticated constructor without a default realm; equivalent
     *  to passing {@code null} for {@code defaultRealm}. Inputs without
     *  an {@code @realm} suffix are passed to F+ verbatim. */
    public FPAuthBackedUserStore(URI baseUrl, Duration timeout,
                                 KerberosAuthenticator authenticator) {
        this(baseUrl, timeout, authenticator, null);
    }

    /** Production constructor. When {@code authenticator} is non-null
     *  every request gets {@code Authorization: Negotiate <token>}
     *  derived from it. When {@code defaultRealm} is non-blank, a
     *  {@code findByUsername} call with no {@code @realm} suffix has
     *  {@code @<defaultRealm>} appended before the F+ lookup, letting
     *  local users log in with their short name. Inputs that already
     *  contain {@code @} are passed through verbatim, preserving
     *  cross-realm logins. */
    public FPAuthBackedUserStore(URI baseUrl, Duration timeout,
                                 KerberosAuthenticator authenticator,
                                 String defaultRealm) {
        this(baseUrl, timeout, authenticator, defaultRealm,
            Set.of(), Map.of(), timeout);
    }

    /** Cross-realm constructor.
     *
     *  <p>{@code trustedRealms} names the Kerberos realms whose users
     *  may log in without a pre-existing local F+ principal. Matching
     *  is case-insensitive because Keycloak lower-cases the username
     *  before it reaches us. An empty set (the default everywhere
     *  else) disables the feature entirely.
     *
     *  <p>{@code homeAuthUrls} maps realm name to that realm's F+ auth
     *  base URL. A trusted realm present here has its principal UUID
     *  resolved from the home cluster; a trusted realm absent from it
     *  gets a fresh locally-minted UUID instead.
     *
     *  <p>{@code homeTimeout} bounds the remote resolve. It must be
     *  small: the remote call happens in series after the local miss,
     *  and Keycloak hard-kills the whole user-storage lookup at 3
     *  seconds. See {@code FactoryPlusUserStorageProviderFactory}. */
    public FPAuthBackedUserStore(URI baseUrl, Duration timeout,
                                 KerberosAuthenticator authenticator,
                                 String defaultRealm,
                                 Set<String> trustedRealms,
                                 Map<String, URI> homeAuthUrls,
                                 Duration homeTimeout) {
        this.baseUrl = baseUrl;
        this.timeout = timeout;
        this.authenticator = authenticator;
        this.defaultRealm = (defaultRealm == null || defaultRealm.isBlank())
            ? null : defaultRealm.trim();

        Set<String> realms = new HashSet<>();
        for (String r : trustedRealms) {
            if (r == null || r.isBlank()) continue;
            realms.add(canonical_realm(r));
        }
        this.trustedRealms = Set.copyOf(realms);

        Map<String, FactoryPlusUserStore> homes = new HashMap<>();
        Map<String, URI> urls = new HashMap<>();
        for (Map.Entry<String, URI> e : homeAuthUrls.entrySet()) {
            String realm = canonical_realm(e.getKey());
            if (!this.trustedRealms.contains(realm)) continue;
            urls.put(realm, e.getValue());
            /* Reuse this class as the remote client: it already does
             * the identity + principal GETs and the SPNEGO handshake,
             * and JaasKerberosAuthenticator derives the service
             * principal from the target host, so the ticket is for the
             * remote realm's HTTP service. No default realm and no
             * trusted realms of its own - the remote store is a leaf. */
            homes.put(realm, new FPAuthBackedUserStore(
                e.getValue(), homeTimeout, authenticator, null));
        }
        this.homeStores = Map.copyOf(homes);
        this.homeAuthUrls = Map.copyOf(urls);

        // Pin HTTP/1.1: Java's default tries an h2c upgrade on plaintext
        // connections (sends Upgrade: h2c + Connection: Upgrade). Node's
        // HTTP parser rejects that with 400 "Invalid Upgrade header".
        this.http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(timeout)
            .build();
    }

    @Override
    public Optional<FactoryPlusUser> findByUuid(String uuid) {
        return fetchPrincipal(uuid);
    }

    @Override
    public Optional<FactoryPlusUser> findByUsername(String username) {
        List<String> candidates = candidateUpns(applyDefaultRealm(username));
        for (String upn : candidates) {
            Optional<FactoryPlusUser> found =
                fetchUuidByIdentity(IDENTITY_KIND_KERBEROS, upn)
                    .flatMap(this::fetchPrincipal);
            if (found.isPresent()) return found;
        }
        return resolveCrossRealm(candidates);
    }

    /** Short names get {@code @<defaultRealm>} appended so local users
     *  can log in with just their username. Inputs that already
     *  contain {@code @} (and the default realm itself) are used
     *  verbatim here; the realm-case retry happens in
     *  {@link #candidateUpns}. */
    private String applyDefaultRealm(String username) {
        if (username == null) return null;
        if (username.contains("@")) return username;
        if (defaultRealm == null) return username;
        return username + "@" + defaultRealm;
    }

    /** The UPNs to try against F+, in order.
     *
     *  <p>Keycloak lower-cases the whole username before it reaches the
     *  provider, so a user typing {@code me1ago@AMRC-FP.SHEF.AC.UK}
     *  arrives as {@code me1ago@amrc-fp.shef.ac.uk}. F+ Auth compares
     *  identity names with exact string equality, so the lookup misses
     *  even though the principal exists. We therefore retry with the
     *  realm portion (everything after the LAST {@code @}) upper-cased.
     *
     *  <p>Retry rather than unconditional upper-casing: uppercase
     *  Kerberos realms are convention, not a rule, and a deployment
     *  whose realm genuinely is lower case must keep working. The
     *  verbatim form is always tried first, so those deployments are
     *  unaffected and pay no extra request.
     *
     *  <p>Known limitation: only the realm is touched. An F+ identity
     *  stored with capitals in the user portion ({@code Me1ago@...})
     *  will still not match, because Keycloak has already folded the
     *  case and the original is unrecoverable. Store user portions in
     *  lower case. */
    static List<String> candidateUpns(String upn) {
        if (upn == null) return List.of();
        int at = upn.lastIndexOf('@');
        if (at < 0) return List.of(upn);
        String realm = upn.substring(at + 1);
        String upper = canonical_realm(realm);
        if (upper.equals(realm)) return List.of(upn);
        return List.of(upn, upn.substring(0, at) + "@" + upper);
    }

    private static String canonical_realm(String realm) {
        return realm.trim().toUpperCase(Locale.ROOT);
    }

    /** Cross-realm fallback, reached only when every casing candidate
     *  missed locally.
     *
     *  <p>Kerberos cross-realm trust is a KDC-level fact: it provisions
     *  nothing in Factory+, so a foreign user has no principal here to
     *  resolve. When their realm is explicitly trusted we return a
     *  provisional user - a promise that, if the KDC confirms the
     *  password, the provider will write the identity via
     *  {@link #admit}. Nothing is written on this path: lookup happens
     *  before the password is checked, so it runs for unauthenticated
     *  callers.
     *
     *  <p>Untrusted realms return empty, exactly as before this
     *  feature existed. */
    private Optional<FactoryPlusUser> resolveCrossRealm(List<String> candidates) {
        if (trustedRealms.isEmpty() || candidates.isEmpty())
            return Optional.empty();

        /* Last candidate carries the upper-cased realm, which is the
         * form we canonicalise a mirrored principal to. */
        String canonical = candidates.get(candidates.size() - 1);
        int at = canonical.lastIndexOf('@');
        if (at < 0) return Optional.empty();
        String realm = canonical_realm(canonical.substring(at + 1));
        if (!trustedRealms.contains(realm)) return Optional.empty();

        FactoryPlusUserStore home = homeStores.get(realm);
        if (home == null) {
            /* Trusted realm with no auth URL: no outbound dependency at
             * all, just mint an identity for them on first successful
             * login. */
            return Optional.of(provisional(freshUuid(), canonical));
        }

        /* A standing denial short-circuits before we make any call.
         * See recordDenial for why this one failure mode is cached and
         * the others deliberately are not. */
        throwIfDenied(realm);

        /* Resolve against the home cluster's F+ Auth. A timeout or 5xx
         * propagates as FactoryPlusAuthException, so Keycloak fails the
         * login instead of reporting user_not_found - "the home cluster
         * is unreachable" and "no such user" are different answers. A
         * 410/404 falls out as empty and gets negatively cached by the
         * caching decorator. */
        try {
            for (String upn : candidates) {
                Optional<FactoryPlusUser> found = home.findByUsername(upn);
                if (found.isEmpty()) continue;
                /* Prefer the home cluster's own spelling of the UPN over
                 * the candidate that happened to match: it is the
                 * authoritative casing, and it is what we mirror locally. */
                FactoryPlusUser hit = found.get();
                String name = hit.username() == null ? upn : hit.username();
                return Optional.of(provisional(hit.uuid(), name));
            }
        }
        catch (FactoryPlusAccessDeniedException e) {
            throw recordDenial(realm, e);
        }
        return Optional.empty();
    }

    /** How long a 403 from a home cluster suppresses further calls to
     *  it. Short enough that fixing the grant takes effect promptly,
     *  long enough that a standing misconfiguration doesn't cost an
     *  outbound call per login attempt. */
    private static final Duration DENIAL_TTL = Duration.ofSeconds(30);

    /** Home clusters that have refused us, and when the denial expires.
     *  Keyed by realm: the denial is a property of the trust
     *  relationship, not of the user who happened to trigger it. */
    private final ConcurrentMap<String, Instant> homeDenials =
        new ConcurrentHashMap<>();

    /** Turn a bare 403 into something an operator can act on, and
     *  remember it briefly.
     *
     *  <p>A 403 here means the home cluster has not granted this
     *  cluster's SPI principal {@code ReadKrb}. That is the single most
     *  likely setup mistake in this feature, and the fix lives on a
     *  different cluster from the error, so the message names the
     *  permission, the principal that was denied, and who denied it.
     *
     *  <p>We deliberately do NOT fall back to minting a fresh UUID.
     *  The {@code ReadKrb} grant is the kill switch for the whole trust
     *  relationship; minting on denial would defeat revocation and
     *  split the estate into home-derived and locally-minted principals
     *  depending on when each user first logged in.
     *
     *  <p>Caching: {@link CachingFactoryPlusUserStore} deliberately
     *  never caches exceptions, so a transient F+ blip cannot lock out
     *  lookups for a full TTL. That reasoning holds for 5xx and
     *  timeouts and is unchanged. A 403 is different in kind: it is a
     *  standing configuration state, and lookup runs BEFORE password
     *  validation, so while misconfigured anyone who can reach the
     *  login page could bounce one call off the remote cluster per
     *  attempt just by typing foreign usernames. Hence this small
     *  realm-keyed denial cache, which suppresses the call without
     *  softening the failure. */
    private FactoryPlusAccessDeniedException recordDenial(
            String realm, FactoryPlusAccessDeniedException cause) {
        homeDenials.put(realm, Instant.now().plus(DENIAL_TTL));
        return deniedException(realm, cause);
    }

    private void throwIfDenied(String realm) {
        Instant until = homeDenials.get(realm);
        if (until == null) return;
        if (until.isBefore(Instant.now())) {
            homeDenials.remove(realm, until);
            return;
        }
        throw deniedException(realm, null);
    }

    private FactoryPlusAccessDeniedException deniedException(
            String realm, Throwable cause) {
        URI homeUrl = homeAuthUrls.get(realm);
        String principal = authenticator == null ? null
            : authenticator.principalName();
        String msg = "Cross-realm login from " + realm + " failed: the home"
            + " Factory+ Auth service" + (homeUrl == null ? "" : " at " + homeUrl)
            + " refused the identity lookup with 403. Grant "
            + (principal == null ? "this cluster's SPI principal" : principal)
            + " the ReadKrb permission"
            + " (e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c) on the Wildcard target"
            + " in " + realm + "'s Factory+ Auth. Note ReadKrb is blanket"
            + " read of every identity record and cannot be narrowed;"
            + " if that is not acceptable, remove this realm's entry from"
            + " trusted.realm.auth.urls to mint local principals instead.";
        return cause == null
            ? new FactoryPlusAccessDeniedException(msg)
            : new FactoryPlusAccessDeniedException(msg, cause);
    }

    /** Provisional users carry a real UUID from the moment of lookup,
     *  even on the mint-fresh path where nothing has resolved it.
     *  Keycloak derives the federated storage id from it and re-reads
     *  the user by that id later in the same login flow, so a null here
     *  would break the flow after {@link #admit} had already written.
     *  Minting early is safe: the UUID is not persisted anywhere until
     *  the KDC has confirmed the password. */
    private static FactoryPlusUser provisional(String uuid, String upn) {
        return new FactoryPlusUser(
            uuid == null ? freshUuid() : uuid, upn, null, true);
    }

    private static String freshUuid() {
        return UUID.randomUUID().toString();
    }

    @Override
    public String admit(String upn, String uuid) {
        String target = (uuid == null || uuid.isBlank()) ? freshUuid() : uuid;
        URI uri = baseUrl.resolve("/v2/principal/" + encode(target)
            + "/" + encode(IDENTITY_KIND_KERBEROS));
        /* acs-auth parses request bodies with express.json({strict:
         * false}), so the UPN goes over the wire as a JSON string
         * literal, not as bare text. */
        HttpResponse<String> res = sendPut(uri, jsonString(upn));
        requireSuccess(res, uri);
        return target;
    }

    private static String jsonString(String value) {
        try {
            return MAPPER.writeValueAsString(value);
        }
        catch (JsonProcessingException e) {
            throw new FactoryPlusAuthException("Cannot encode " + value, e);
        }
    }

    @Override
    public Optional<FactoryPlusUser> findByEmail(String email) {
        // F+ has no email field; this lookup is unsupported and always
        // returns empty. Reserved for a future F+ schema extension.
        return Optional.empty();
    }

    @Override
    public Set<String> findPermissionsForPrincipal(String uuid) {
        return fetchWildcardPermissions(uuid);
    }

    /** GET /v2/identity/{kind}/{name} -> UUID string, or empty on 410. */
    private Optional<String> fetchUuidByIdentity(String kind, String name) {
        URI uri = baseUrl.resolve("/v2/identity/" + encode(kind) + "/" + encode(name));
        HttpResponse<String> res = sendGet(uri);
        if (isNotFound(res.statusCode())) return Optional.empty();
        requireSuccess(res, uri);

        try {
            JsonNode node = MAPPER.readTree(res.body());
            if (!node.isTextual()) {
                throw new FactoryPlusAuthException(
                    "Expected UUID string from " + uri + ", got: " + res.body());
            }
            return Optional.of(node.asText());
        }
        catch (JsonProcessingException e) {
            throw new FactoryPlusAuthException("Malformed response from " + uri, e);
        }
    }

    /** All-zero UUID = F+ Wildcard target. Permissions granted on this
     *  target are global ("any object"), the analogue of a role. */
    private static final String WILDCARD_TARGET =
        "00000000-0000-0000-0000-000000000000";

    /** GET /v2/acl/{uuid} -> [{permission, target, plural?}, ...].
     *  Filters to entries with target=Wildcard and returns the unique
     *  set of permission UUIDs. Empty on 410/404 (principal absent or
     *  caller cannot read any of its grants). */
    private Set<String> fetchWildcardPermissions(String uuid) {
        URI uri = baseUrl.resolve("/v2/acl/" + encode(uuid));
        HttpResponse<String> res = sendGet(uri);
        if (isNotFound(res.statusCode())) return Set.of();
        requireSuccess(res, uri);

        try {
            JsonNode root = MAPPER.readTree(res.body());
            if (!root.isArray()) {
                throw new FactoryPlusAuthException(
                    "Expected JSON array of ACL entries from " + uri
                        + ", got: " + res.body());
            }
            Set<String> out = new HashSet<>();
            for (JsonNode entry : root) {
                JsonNode perm = entry.get("permission");
                JsonNode targ = entry.get("target");
                if (perm == null || !perm.isTextual()) continue;
                if (targ == null || !targ.isTextual()) continue;
                if (!WILDCARD_TARGET.equals(targ.asText())) continue;
                out.add(perm.asText());
            }
            return Set.copyOf(out);
        }
        catch (JsonProcessingException e) {
            throw new FactoryPlusAuthException(
                "Malformed response from " + uri, e);
        }
    }

    /** GET /v2/principal/{uuid} -> {uuid, kerberos: "..."}, or empty on 410. */
    private Optional<FactoryPlusUser> fetchPrincipal(String uuid) {
        URI uri = baseUrl.resolve("/v2/principal/" + encode(uuid));
        HttpResponse<String> res = sendGet(uri);
        if (isNotFound(res.statusCode())) return Optional.empty();
        requireSuccess(res, uri);

        try {
            JsonNode root = MAPPER.readTree(res.body());
            if (!root.isObject() || !root.hasNonNull("uuid")) {
                throw new FactoryPlusAuthException(
                    "Malformed principal response from " + uri
                        + " (missing uuid field)");
            }
            JsonNode kerberosNode = root.get(IDENTITY_KIND_KERBEROS);
            if (kerberosNode == null || kerberosNode.isNull()) {
                // Principal exists but has no Kerberos identity. We
                // can't surface it as a Keycloak user without a
                // username, so treat as not-found from the SPI's
                // perspective rather than NPE later.
                return Optional.empty();
            }
            return Optional.of(new FactoryPlusUser(
                root.get("uuid").asText(),
                kerberosNode.asText(),
                null /* F+ has no email */));
        }
        catch (JsonProcessingException e) {
            throw new FactoryPlusAuthException(
                "Malformed response from " + uri, e);
        }
    }

    private HttpResponse<String> sendGet(URI uri) {
        return send(uri, null);
    }

    private HttpResponse<String> sendPut(URI uri, String body) {
        return send(uri, body);
    }

    /** GET when {@code body} is null, PUT otherwise. */
    private HttpResponse<String> send(URI uri, String body) {
        // Fresh HttpClient (and therefore fresh TCP socket) per
        // request. The F+ auth Node HTTP server's idle keep-alive
        // timeout (~5s) is shorter than the JDK HttpClient's default
        // (1200s), so a shared client racing the server eventually
        // reuses a half-dead socket and the SPI lookup fails with
        // "received no bytes" after Keycloak's 3s storage timeout.
        // Login traffic is sparse enough that the per-call client
        // overhead is negligible.
        HttpClient oneShot = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(timeout)
            .build();
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
            .timeout(timeout)
            .header("Accept", "application/json");
        if (body == null) {
            builder.GET();
        }
        else {
            builder.header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        }
        if (authenticator != null) {
            builder.header("Authorization", "Negotiate " + authenticator.spnegoTokenFor(uri));
        }
        HttpRequest req = builder.build();
        try {
            return oneShot.send(req, HttpResponse.BodyHandlers.ofString());
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new FactoryPlusAuthException("Interrupted calling " + uri, e);
        }
        catch (IOException e) {
            throw new FactoryPlusAuthException("Transport failure calling " + uri, e);
        }
    }

    /** F+ uses 410 for "doesn't exist". Some clients/proxies may also
     *  surface 404; accept both for resilience. */
    private static boolean isNotFound(int status) {
        return status == 410 || status == 404;
    }

    private static void requireSuccess(HttpResponse<String> res, URI uri) {
        int status = res.statusCode();
        if (status < 200 || status >= 300) {
            String body = res.body();
            if (body != null && body.length() > 500)
                body = body.substring(0, 500) + "...[truncated]";
            String msg = "F+ auth returned " + status + " for " + uri
                + " body=" + body;
            // 403 gets its own type so the cross-realm resolve can
            // distinguish a standing permission problem from a
            // transient fault. Both stay fatal.
            if (status == 403) throw new FactoryPlusAccessDeniedException(msg);
            throw new FactoryPlusAuthException(msg);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
