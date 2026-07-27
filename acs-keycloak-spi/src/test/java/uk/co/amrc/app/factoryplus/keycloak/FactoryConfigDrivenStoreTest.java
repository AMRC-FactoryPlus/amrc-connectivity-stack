/* ACS Keycloak SPI
 * The factory picks an FPAuthBackedUserStore when configured with a
 * F+ auth URL, or the NullFactoryPlusUserStore when not.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.keycloak.common.util.MultivaluedHashMap;
import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.provider.ProviderConfigProperty;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class FactoryConfigDrivenStoreTest {

    @Mock KeycloakSession session;
    @Mock ComponentModel model;

    private final FactoryPlusUserStorageProviderFactory factory =
        new FactoryPlusUserStorageProviderFactory();

    @Test
    void create_returns_null_store_when_no_auth_url_configured() {
        when(model.getConfig()).thenReturn(new MultivaluedHashMap<>());

        FactoryPlusUserStorageProvider provider = factory.create(session, model);

        assertThat(provider.getStore()).isInstanceOf(NullFactoryPlusUserStore.class);
    }

    @Test
    void create_returns_fp_auth_backed_store_when_url_configured_and_cache_disabled() {
        var config = new MultivaluedHashMap<String, String>();
        config.putSingle("auth.url", "http://localhost:9999");
        config.putSingle("cache.ttl.seconds", "0");
        when(model.getConfig()).thenReturn(config);

        FactoryPlusUserStorageProvider provider = factory.create(session, model);

        assertThat(provider.getStore()).isInstanceOf(FPAuthBackedUserStore.class);
    }

    @Test
    void create_falls_back_to_null_store_when_url_is_blank() {
        var config = new MultivaluedHashMap<String, String>();
        config.putSingle("auth.url", "");
        when(model.getConfig()).thenReturn(config);

        FactoryPlusUserStorageProvider provider = factory.create(session, model);

        assertThat(provider.getStore()).isInstanceOf(NullFactoryPlusUserStore.class);
    }

    @Test
    void config_properties_advertise_full_set_to_keycloak_admin_ui() {
        List<ProviderConfigProperty> props = factory.getConfigProperties();

        assertThat(props)
            .extracting(ProviderConfigProperty::getName)
            .as("Admin UI must expose all the configurable surface")
            .contains("auth.url", "auth.timeout.seconds", "cache.ttl.seconds",
                "auth.principal", "auth.keytab.path");
    }

    @Test
    void create_wraps_fp_auth_store_in_cache_when_ttl_positive() {
        var config = new MultivaluedHashMap<String, String>();
        config.putSingle("auth.url", "http://localhost:9999");
        config.putSingle("cache.ttl.seconds", "60");
        when(model.getConfig()).thenReturn(config);

        FactoryPlusUserStorageProvider provider = factory.create(session, model);

        assertThat(provider.getStore()).isInstanceOf(CachingFactoryPlusUserStore.class);
    }

    @Test
    void create_skips_cache_wrap_when_ttl_zero() {
        var config = new MultivaluedHashMap<String, String>();
        config.putSingle("auth.url", "http://localhost:9999");
        config.putSingle("cache.ttl.seconds", "0");
        when(model.getConfig()).thenReturn(config);

        FactoryPlusUserStorageProvider provider = factory.create(session, model);

        assertThat(provider.getStore())
            .as("ttl=0 disables caching; expose the raw F+ store")
            .isInstanceOf(FPAuthBackedUserStore.class);
    }

    @Test
    void create_uses_default_60s_cache_when_ttl_unset() {
        var config = new MultivaluedHashMap<String, String>();
        config.putSingle("auth.url", "http://localhost:9999");
        // cache.ttl.seconds NOT set
        when(model.getConfig()).thenReturn(config);

        FactoryPlusUserStorageProvider provider = factory.create(session, model);

        assertThat(provider.getStore()).isInstanceOf(CachingFactoryPlusUserStore.class);
    }

    // -- cross-realm config parsing --------------------------------------

    @Test
    void trusted_realms_default_to_none() {
        // Cross-realm support must be inert until an admin opts in.
        assertThat(FactoryPlusUserStorageProviderFactory.parseList(null)).isEmpty();
        assertThat(FactoryPlusUserStorageProviderFactory.parseList("")).isEmpty();
        assertThat(FactoryPlusUserStorageProviderFactory.parseList("  ")).isEmpty();
    }

    @Test
    void trusted_realms_parse_as_a_comma_separated_list() {
        assertThat(FactoryPlusUserStorageProviderFactory.parseList(
                "A.REALM, B.REALM ,,C.REALM"))
            .containsExactlyInAnyOrder("A.REALM", "B.REALM", "C.REALM");
    }

    @Test
    void trusted_realm_auth_urls_parse_as_flat_realm_equals_url_entries() {
        // Flat encoding because Keycloak's component config is a fixed
        // set of declared keys; per-realm keys can't be declared in
        // getConfigProperties().
        var urls = FactoryPlusUserStorageProviderFactory.parseRealmUrls(
            "A.REALM=https://auth.a.example, B.REALM=http://auth.b.example");

        assertThat(urls).containsOnlyKeys("A.REALM", "B.REALM");
        assertThat(urls.get("A.REALM").getHost()).isEqualTo("auth.a.example");
    }

    @Test
    void malformed_trusted_realm_url_entries_are_dropped_not_fatal() {
        // A typo in one entry degrades that realm to the mint-fresh
        // path rather than breaking the whole federation.
        assertThat(FactoryPlusUserStorageProviderFactory.parseRealmUrls(
                "no-equals-sign, =https://orphan.example, A.REALM=https://auth.a.example"))
            .containsOnlyKeys("A.REALM");
    }

    @Test
    void trusted_realm_timeout_accepts_a_fractional_value() {
        assertThat(FactoryPlusUserStorageProviderFactory
                .parseFractionalSeconds("1.5", "1.5"))
            .isEqualTo(java.time.Duration.ofMillis(1500));
    }

    @Test
    void trusted_realm_timeout_falls_back_on_junk() {
        assertThat(FactoryPlusUserStorageProviderFactory
                .parseFractionalSeconds("soon", "1.5"))
            .isEqualTo(java.time.Duration.ofMillis(1500));
        assertThat(FactoryPlusUserStorageProviderFactory
                .parseFractionalSeconds(null, "1.5"))
            .isEqualTo(java.time.Duration.ofMillis(1500));
    }
}
