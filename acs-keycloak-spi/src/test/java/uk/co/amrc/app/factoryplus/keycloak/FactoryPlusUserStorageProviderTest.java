/* ACS Keycloak SPI
 * Verifies the provider delegates Keycloak's UserLookupProvider methods
 * to a FactoryPlusUserStore and wraps results in a FactoryPlusUserAdapter.
 * Uses a Mockito-stubbed store so this test runs without any Keycloak
 * runtime or F+ network.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class FactoryPlusUserStorageProviderTest {

    private static final String MODEL_ID = "11111111-1111-1111-1111-111111111111";
    private static final FactoryPlusUser ALICE = new FactoryPlusUser(
        "00000000-0000-0000-0000-000000000001",
        "alice",
        "alice@example.invalid");

    @Mock KeycloakSession session;
    @Mock RealmModel realm;
    @Mock ComponentModel model;
    @Mock FactoryPlusUserStore store;

    private FactoryPlusUserStorageProvider provider;

    @BeforeEach
    void setUp() {
        when(model.getId()).thenReturn(MODEL_ID);
        provider = new FactoryPlusUserStorageProvider(session, model, store);
    }

    @Test
    void username_lookup_returns_adapter_when_store_finds_user() {
        when(store.findByUsername("alice")).thenReturn(Optional.of(ALICE));

        UserModel user = provider.getUserByUsername(realm, "alice");

        assertThat(user).isNotNull();
        assertThat(user.getUsername()).isEqualTo("alice");
        assertThat(user.getEmail()).isEqualTo("alice@example.invalid");
        assertThat(user).isInstanceOf(FactoryPlusUserAdapter.class);
    }

    @Test
    void username_lookup_returns_null_when_store_returns_empty() {
        when(store.findByUsername("missing")).thenReturn(Optional.empty());

        UserModel user = provider.getUserByUsername(realm, "missing");

        assertThat(user).isNull();
    }

    @Test
    void email_lookup_returns_adapter_when_store_finds_user() {
        when(store.findByEmail("alice@example.invalid")).thenReturn(Optional.of(ALICE));

        UserModel user = provider.getUserByEmail(realm, "alice@example.invalid");

        assertThat(user).isNotNull();
        assertThat(user.getUsername()).isEqualTo("alice");
    }

    @Test
    void email_lookup_returns_null_when_store_returns_empty() {
        when(store.findByEmail("nope@example.invalid")).thenReturn(Optional.empty());

        UserModel user = provider.getUserByEmail(realm, "nope@example.invalid");

        assertThat(user).isNull();
    }

    @Test
    void id_lookup_extracts_external_uuid_from_storage_id_and_finds_user() {
        // Keycloak passes its federated storage id "f:<modelId>:<externalId>"
        // to getUserById. We extract the external part (the F+ UUID) and
        // call findByUuid.
        String storageId = "f:" + MODEL_ID + ":" + ALICE.uuid();
        when(store.findByUuid(ALICE.uuid())).thenReturn(Optional.of(ALICE));

        UserModel user = provider.getUserById(realm, storageId);

        assertThat(user).isNotNull();
        assertThat(user.getUsername()).isEqualTo("alice");
    }

    @Test
    void id_lookup_returns_null_when_store_returns_empty() {
        String storageId = "f:" + MODEL_ID + ":nope-uuid";
        when(store.findByUuid("nope-uuid")).thenReturn(Optional.empty());

        UserModel user = provider.getUserById(realm, storageId);

        assertThat(user).isNull();
    }
}
