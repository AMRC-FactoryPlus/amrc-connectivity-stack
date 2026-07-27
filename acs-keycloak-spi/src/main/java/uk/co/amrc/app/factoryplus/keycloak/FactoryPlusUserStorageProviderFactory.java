/* ACS Keycloak SPI
 * Factory class. Keycloak constructs exactly one of these per server
 * lifetime and calls create(...) for every request that needs to talk to
 * the Factory+ federation.
 *
 * The factory owns the FactoryPlusUserStore and hands it to each provider
 * instance. Sharing the store (and any caches it holds) across requests
 * is much cheaper than constructing a fresh one per call. The choice of
 * store is config-driven: if the realm admin set 'auth.url' on the
 * federation component, we build an FPAuthBackedUserStore pointing at
 * that URL; otherwise the NullFactoryPlusUserStore singleton is used so
 * the SPI loads cleanly with no F+ dependency.
 *
 * Phase 4 will add Kerberos config (auth.principal, auth.keytab.path)
 * and switch the store to use lib/java-service-client's
 * FPGssClientKeytab.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.provider.ProviderConfigurationBuilder;
import org.keycloak.storage.UserStorageProviderFactory;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

public class FactoryPlusUserStorageProviderFactory
        implements UserStorageProviderFactory<FactoryPlusUserStorageProvider> {

    /** Per-componentModel cache. Keycloak invokes {@code create} on every
     *  request that touches user storage; doing a fresh JAAS Krb5
     *  login + GSSContext init each time blows past Keycloak's 3-second
     *  ServicesUtils.timeBoundOne hard limit. The cache key includes
     *  the config so admins editing the federation in the UI rebuild
     *  cleanly. */
    private final ConcurrentMap<CacheKey, CachedStore> storeCache = new ConcurrentHashMap<>();

    private record CacheKey(String componentId, String configHash) {}
    private record CachedStore(FactoryPlusUserStore store) {}

    public static final String PROVIDER_ID = "factoryplus";

    static final String CONFIG_AUTH_URL           = "auth.url";
    static final String CONFIG_TIMEOUT_SECONDS    = "auth.timeout.seconds";
    static final String CONFIG_CACHE_TTL_SECONDS  = "cache.ttl.seconds";
    static final String CONFIG_KRB_PRINCIPAL      = "auth.principal";
    static final String CONFIG_KRB_KEYTAB_PATH    = "auth.keytab.path";
    static final String CONFIG_DEFAULT_REALM      = "default.realm";
    static final String CONFIG_TRUSTED_REALMS     = "trusted.realms";
    static final String CONFIG_TRUSTED_REALM_AUTH_URLS =
        "trusted.realm.auth.urls";
    static final String CONFIG_TRUSTED_REALM_TIMEOUT =
        "trusted.realm.timeout.seconds";
    /* Must stay below Keycloak's 3-second ServicesUtils.timeBoundOne
     * hard limit on user-storage lookups. With a longer value our own
     * timeout can never fire: Keycloak interrupts the thread first and
     * the admin sees an opaque InterruptedException instead of a clean
     * timeout naming the F+ auth service. */
    static final String DEFAULT_TIMEOUT_SECONDS   = "2";
    static final String DEFAULT_CACHE_TTL_SECONDS = "60";
    /* The cross-realm resolve runs in SERIES after the local lookup
     * misses, so the two timeouts add up against the same 3-second
     * budget: 2 + 1.5 already overshoots slightly in the worst case,
     * and anything larger reliably surfaces as an opaque
     * InterruptedException instead of a clean timeout. Do not raise
     * either value without lowering the other. */
    static final String DEFAULT_TRUSTED_REALM_TIMEOUT_SECONDS = "1.5";

    private static final List<ProviderConfigProperty> CONFIG_PROPERTIES =
        ProviderConfigurationBuilder.create()
            .property()
                .name(CONFIG_AUTH_URL)
                .label("Factory+ auth URL")
                .helpText("Base URL of the Factory+ auth service "
                    + "(e.g. http://acs-auth.factory-plus.svc.cluster.local). "
                    + "Leave blank to disable F+ lookups (the federation "
                    + "loads but returns no users).")
                .type(ProviderConfigProperty.STRING_TYPE)
                .add()
            .property()
                .name(CONFIG_TIMEOUT_SECONDS)
                .label("Request timeout (seconds)")
                .helpText("Per-request timeout for F+ auth calls. Keep "
                    + "this below 3 seconds: Keycloak hard-kills user "
                    + "storage lookups at 3s, so a longer value here "
                    + "never takes effect.")
                .type(ProviderConfigProperty.STRING_TYPE)
                .defaultValue(DEFAULT_TIMEOUT_SECONDS)
                .add()
            .property()
                .name(CONFIG_CACHE_TTL_SECONDS)
                .label("Cache TTL (seconds)")
                .helpText("How long to cache F+ user lookups, including misses. "
                    + "Set to 0 to disable caching. Larger values reduce F+ load "
                    + "but staleness window is longer (admin grants/revokes "
                    + "take up to TTL seconds to appear in Keycloak).")
                .type(ProviderConfigProperty.STRING_TYPE)
                .defaultValue(DEFAULT_CACHE_TTL_SECONDS)
                .add()
            .property()
                .name(CONFIG_KRB_PRINCIPAL)
                .label("SPI Kerberos principal")
                .helpText("Principal the SPI authenticates as when calling F+ "
                    + "(e.g. sv1openid@FACTORYPLUS.LOCAL). Leave blank to call "
                    + "F+ unauthenticated (only useful with stand-in servers "
                    + "like Wiremock).")
                .type(ProviderConfigProperty.STRING_TYPE)
                .add()
            .property()
                .name(CONFIG_KRB_KEYTAB_PATH)
                .label("SPI Kerberos keytab path")
                .helpText("Filesystem path to the keytab containing credentials "
                    + "for the SPI principal (e.g. /etc/keytabs/client). The "
                    + "keytab must be readable by Keycloak's process.")
                .type(ProviderConfigProperty.STRING_TYPE)
                .add()
            .property()
                .name(CONFIG_DEFAULT_REALM)
                .label("Default Kerberos realm")
                .helpText("Realm appended to usernames entered without an "
                    + "@realm suffix on the login form, so local users can "
                    + "log in with just their short name "
                    + "(e.g. me1alice -> me1alice@FACTORYPLUS.LOCAL). Inputs "
                    + "that already contain @ are passed through verbatim, "
                    + "preserving cross-realm logins. Leave blank to disable "
                    + "the affordance and require the full UPN.")
                .type(ProviderConfigProperty.STRING_TYPE)
                .add()
            .property()
                .name(CONFIG_TRUSTED_REALMS)
                .label("Trusted Kerberos realms")
                .helpText("Comma-separated Kerberos realms whose users may "
                    + "log in without a pre-existing Factory+ principal on "
                    + "this cluster (e.g. PARTNER.EXAMPLE.ORG). Requires "
                    + "cross-realm trust already configured in krb5.conf. "
                    + "Leave blank - the default - to accept only local "
                    + "principals.")
                .type(ProviderConfigProperty.STRING_TYPE)
                .add()
            .property()
                .name(CONFIG_TRUSTED_REALM_AUTH_URLS)
                .label("Trusted realm auth URLs")
                .helpText("Comma-separated REALM=url entries naming each "
                    + "trusted realm's own Factory+ auth service, used to "
                    + "resolve that realm's principal UUID so the user keeps "
                    + "one identity across clusters. A trusted realm with no "
                    + "entry here gets a freshly minted local UUID instead. "
                    + "Flat encoding because Keycloak component config is a "
                    + "fixed set of declared keys.")
                .type(ProviderConfigProperty.STRING_TYPE)
                .add()
            .property()
                .name(CONFIG_TRUSTED_REALM_TIMEOUT)
                .label("Trusted realm request timeout (seconds)")
                .helpText("Per-request timeout for calls to a trusted realm's "
                    + "Factory+ auth service. This resolve runs after the "
                    + "local lookup misses, so it adds to the request timeout "
                    + "above against Keycloak's 3-second hard limit. Keep it "
                    + "tight.")
                .type(ProviderConfigProperty.STRING_TYPE)
                .defaultValue(DEFAULT_TRUSTED_REALM_TIMEOUT_SECONDS)
                .add()
            .build();

    @Override
    public FactoryPlusUserStorageProvider create(KeycloakSession session, ComponentModel model) {
        FactoryPlusUserStore store = cachedStore(model);
        return new FactoryPlusUserStorageProvider(session, model, store,
            new KerberosPasswordValidator());
    }

    /** Build (or return cached) FactoryPlusUserStore for this component
     *  config. Authenticator construction does a JAAS Kerberos login;
     *  we want that to happen at most once per config, not per request. */
    private FactoryPlusUserStore cachedStore(ComponentModel model) {
        CacheKey key = new CacheKey(model.getId(), configFingerprint(model));
        // Drop stale entries for this component (different config).
        storeCache.keySet().removeIf(k ->
            Objects.equals(k.componentId(), key.componentId())
                && !Objects.equals(k.configHash(), key.configHash()));
        return storeCache
            .computeIfAbsent(key, k -> new CachedStore(buildStore(model)))
            .store();
    }

    private static String configFingerprint(ComponentModel model) {
        // Cheap, order-stable fingerprint of the auth-affecting config
        // values. Any change here causes a clean rebuild.
        StringBuilder sb = new StringBuilder();
        for (String k : List.of(CONFIG_AUTH_URL, CONFIG_TIMEOUT_SECONDS,
                CONFIG_CACHE_TTL_SECONDS, CONFIG_KRB_PRINCIPAL,
                CONFIG_KRB_KEYTAB_PATH, CONFIG_DEFAULT_REALM,
                CONFIG_TRUSTED_REALMS, CONFIG_TRUSTED_REALM_AUTH_URLS,
                CONFIG_TRUSTED_REALM_TIMEOUT)) {
            sb.append(k).append('=')
              .append(model.getConfig().getFirst(k)).append(';');
        }
        return sb.toString();
    }

    private static FactoryPlusUserStore buildStore(ComponentModel model) {
        String url = model.getConfig().getFirst(CONFIG_AUTH_URL);
        if (url == null || url.isBlank()) {
            return NullFactoryPlusUserStore.INSTANCE;
        }
        Duration timeout = parseSeconds(
            model.getConfig().getFirst(CONFIG_TIMEOUT_SECONDS),
            DEFAULT_TIMEOUT_SECONDS);

        KerberosAuthenticator auth = buildAuthenticator(model);
        String defaultRealm = model.getConfig().getFirst(CONFIG_DEFAULT_REALM);
        Set<String> trusted = parseList(
            model.getConfig().getFirst(CONFIG_TRUSTED_REALMS));
        Map<String, URI> homeUrls = parseRealmUrls(
            model.getConfig().getFirst(CONFIG_TRUSTED_REALM_AUTH_URLS));
        Duration homeTimeout = parseFractionalSeconds(
            model.getConfig().getFirst(CONFIG_TRUSTED_REALM_TIMEOUT),
            DEFAULT_TRUSTED_REALM_TIMEOUT_SECONDS);
        FactoryPlusUserStore base = new FPAuthBackedUserStore(
            URI.create(url), timeout, auth, defaultRealm,
            trusted, homeUrls, homeTimeout);

        Duration cacheTtl = parseSeconds(
            model.getConfig().getFirst(CONFIG_CACHE_TTL_SECONDS),
            DEFAULT_CACHE_TTL_SECONDS);
        if (cacheTtl.isZero() || cacheTtl.isNegative()) {
            return base;
        }
        return new CachingFactoryPlusUserStore(base, cacheTtl, Clock.systemUTC());
    }

    /** Returns a {@link KerberosAuthenticator} when both principal and
     *  keytab are configured; null otherwise. Null leaves the SPI calling
     *  F+ unauthenticated, which only makes sense for a Wiremock-style
     *  stand-in server. */
    private static KerberosAuthenticator buildAuthenticator(ComponentModel model) {
        String principal = model.getConfig().getFirst(CONFIG_KRB_PRINCIPAL);
        String keytab = model.getConfig().getFirst(CONFIG_KRB_KEYTAB_PATH);
        if (principal == null || principal.isBlank()
            || keytab == null || keytab.isBlank()) {
            return null;
        }
        return new JaasKerberosAuthenticator(principal, keytab);
    }

    /** Comma-separated list, blanks dropped. Absent or empty yields an
     *  empty set, which is what keeps cross-realm support inert until
     *  an admin opts in. */
    static Set<String> parseList(String configured) {
        if (configured == null || configured.isBlank()) return Set.of();
        Set<String> out = new LinkedHashSet<>();
        for (String part : configured.split(",")) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) out.add(trimmed);
        }
        return Set.copyOf(out);
    }

    /** Comma-separated {@code REALM=url} entries. Malformed entries
     *  (no {@code =}, blank realm, unparseable URL) are dropped rather
     *  than failing the whole federation: the realm then falls back to
     *  the mint-fresh path, which is degraded but working. */
    static Map<String, URI> parseRealmUrls(String configured) {
        if (configured == null || configured.isBlank()) return Map.of();
        Map<String, URI> out = new LinkedHashMap<>();
        for (String part : configured.split(",")) {
            String entry = part.trim();
            if (entry.isEmpty()) continue;
            int eq = entry.indexOf('=');
            if (eq <= 0) continue;
            String realm = entry.substring(0, eq).trim();
            String url = entry.substring(eq + 1).trim();
            if (realm.isEmpty() || url.isEmpty()) continue;
            try {
                out.put(realm, URI.create(url));
            }
            catch (IllegalArgumentException e) {
                /* Skip; the realm degrades to the mint-fresh path. */
            }
        }
        return Map.copyOf(out);
    }

    /** Like {@link #parseSeconds} but accepts a fractional value, since
     *  the cross-realm timeout default is 1.5s. */
    static Duration parseFractionalSeconds(String configured, String fallback) {
        double secs;
        try {
            secs = Double.parseDouble(configured == null || configured.isBlank()
                ? fallback
                : configured.trim());
        }
        catch (NumberFormatException e) {
            secs = Double.parseDouble(fallback);
        }
        if (secs <= 0) secs = Double.parseDouble(fallback);
        return Duration.ofMillis(Math.round(secs * 1000));
    }

    private static Duration parseSeconds(String configured, String fallback) {
        long secs;
        try {
            secs = Long.parseLong(configured == null || configured.isBlank()
                ? fallback
                : configured.trim());
        }
        catch (NumberFormatException e) {
            secs = Long.parseLong(fallback);
        }
        return Duration.ofSeconds(secs);
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return CONFIG_PROPERTIES;
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }
}
