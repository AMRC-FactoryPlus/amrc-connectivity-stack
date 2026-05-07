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
import java.util.List;

public class FactoryPlusUserStorageProviderFactory
        implements UserStorageProviderFactory<FactoryPlusUserStorageProvider> {

    public static final String PROVIDER_ID = "factoryplus";

    static final String CONFIG_AUTH_URL           = "auth.url";
    static final String CONFIG_TIMEOUT_SECONDS    = "auth.timeout.seconds";
    static final String CONFIG_CACHE_TTL_SECONDS  = "cache.ttl.seconds";
    static final String CONFIG_KRB_PRINCIPAL      = "auth.principal";
    static final String CONFIG_KRB_KEYTAB_PATH    = "auth.keytab.path";
    static final String DEFAULT_TIMEOUT_SECONDS   = "5";
    static final String DEFAULT_CACHE_TTL_SECONDS = "60";

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
                .helpText("Per-request timeout for F+ auth calls.")
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
            .build();

    @Override
    public FactoryPlusUserStorageProvider create(KeycloakSession session, ComponentModel model) {
        FactoryPlusUserStore store = buildStore(model);
        return new FactoryPlusUserStorageProvider(session, model, store);
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
        FactoryPlusUserStore base = new FPAuthBackedUserStore(
            URI.create(url), timeout, auth);

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
