/* ACS Keycloak SPI
 * Adapter wraps an immutable FactoryPlusUser DTO as Keycloak's UserModel.
 * Tests cover only the fields we override; everything else is inherited
 * from AbstractUserAdapter and tested by Keycloak upstream.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class FactoryPlusUserAdapterTest {

    private static final String MODEL_ID = "11111111-1111-1111-1111-111111111111";
    private static final FactoryPlusUser ALICE = new FactoryPlusUser(
        "00000000-0000-0000-0000-000000000001",
        "alice",
        "alice@example.invalid");

    @Mock KeycloakSession session;
    @Mock RealmModel realm;
    @Mock ComponentModel model;

    private FactoryPlusUserAdapter adapter;

    @BeforeEach
    void setUp() {
        when(model.getId()).thenReturn(MODEL_ID);
        adapter = new FactoryPlusUserAdapter(session, realm, model, ALICE, NullFactoryPlusUserStore.INSTANCE);
    }

    @Test
    void exposes_username_from_dto() {
        assertThat(adapter.getUsername()).isEqualTo("alice");
    }

    @Test
    void exposes_email_from_dto() {
        assertThat(adapter.getEmail()).isEqualTo("alice@example.invalid");
    }

    @Test
    void factoryplus_uuid_accessor_returns_dto_uuid() {
        assertThat(adapter.getFactoryPlusUuid()).isEqualTo(ALICE.uuid());
    }

    @Test
    void storage_id_uses_user_uuid_not_username() {
        // Keycloak federated storage id format: "f:<modelId>:<externalId>".
        // We use the F+ UUID as external id - it's stable across renames,
        // unlike username.
        assertThat(adapter.getId())
            .isEqualTo("f:" + MODEL_ID + ":" + ALICE.uuid());
    }

    @Test
    void falls_back_to_username_when_dto_email_is_null() {
        // F+ has no email field; we synthesise the email from the UPN
        // so downstream OIDC consumers (Grafana) don't 500 on missing
        // email. Real email values from the DTO still take precedence.
        FactoryPlusUser noEmail = new FactoryPlusUser(
            "00000000-0000-0000-0000-000000000002", "bob", null);
        var bob = new FactoryPlusUserAdapter(session, realm, model, noEmail,
            NullFactoryPlusUserStore.INSTANCE);
        assertThat(bob.getEmail()).isEqualTo("bob");
    }

    @Test
    void getAttributeStream_username_falls_through_to_super() {
        // Keycloak's oidc-usermodel-attribute-mapper queries the per-name
        // attribute API (getAttributeStream / getFirstAttribute). The
        // standard "username" mapper expects to see the user's username
        // back. Returning Stream.empty() for everything but our F+
        // attributes masked username/email and made userinfo emit
        // preferred_username=null whenever Keycloak's user cache wasn't
        // in front of us (i.e. cachePolicy=NO_CACHE). Delegate to super.
        assertThat(adapter.getAttributeStream("username"))
            .containsExactly("alice");
        assertThat(adapter.getFirstAttribute("username")).isEqualTo("alice");
    }

    @Test
    void getAttributeStream_email_falls_through_to_super() {
        assertThat(adapter.getAttributeStream("email"))
            .containsExactly("alice@example.invalid");
        assertThat(adapter.getFirstAttribute("email"))
            .isEqualTo("alice@example.invalid");
    }

    @Test
    void getAttributeStream_fp_attributes_still_served_locally() {
        // Our overrides for the F+ attributes must NOT delegate to super
        // - we own those names exclusively.
        assertThat(adapter.getAttributeStream(FactoryPlusUserAdapter.ATTR_FP_UUID))
            .containsExactly(ALICE.uuid());
        assertThat(adapter.getFirstAttribute(FactoryPlusUserAdapter.ATTR_FP_UUID))
            .isEqualTo(ALICE.uuid());
    }

    @Test
    void factoryplus_groups_delegates_to_store() {
        var stubStore = new StubGroupsStore(java.util.Set.of("g1", "g2"));
        var alice = new FactoryPlusUserAdapter(session, realm, model, ALICE, stubStore);

        assertThat(alice.getFactoryPlusPermissions()).containsExactlyInAnyOrder("g1", "g2");
        assertThat(stubStore.lastUuid)
            .as("Store must be queried with the principal's F+ UUID")
            .isEqualTo(ALICE.uuid());
    }

    private static final class StubGroupsStore implements FactoryPlusUserStore {
        private final java.util.Set<String> response;
        String lastUuid;

        StubGroupsStore(java.util.Set<String> response) { this.response = response; }

        @Override public java.util.Optional<FactoryPlusUser> findByUuid(String uuid) {
            return java.util.Optional.empty();
        }
        @Override public java.util.Optional<FactoryPlusUser> findByUsername(String n) {
            return java.util.Optional.empty();
        }
        @Override public java.util.Optional<FactoryPlusUser> findByEmail(String e) {
            return java.util.Optional.empty();
        }
        @Override public java.util.Set<String> findPermissionsForPrincipal(String uuid) {
            lastUuid = uuid;
            return response;
        }
    }
}
