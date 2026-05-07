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
    void create_returns_fp_auth_backed_store_when_url_configured() {
        var config = new MultivaluedHashMap<String, String>();
        config.putSingle("auth.url", "http://localhost:9999");
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
    void config_properties_advertise_url_and_timeout_to_keycloak_admin_ui() {
        List<ProviderConfigProperty> props = factory.getConfigProperties();

        assertThat(props)
            .extracting(ProviderConfigProperty::getName)
            .as("Admin UI must expose at least the F+ auth URL and the request timeout")
            .contains("auth.url", "auth.timeout.seconds");
    }
}
