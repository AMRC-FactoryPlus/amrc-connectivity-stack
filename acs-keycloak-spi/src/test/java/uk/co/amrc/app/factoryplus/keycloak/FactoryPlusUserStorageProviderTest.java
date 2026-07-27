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
import org.keycloak.credential.CredentialInput;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserCredentialModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.credential.PasswordCredentialModel;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
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
        provider = new FactoryPlusUserStorageProvider(session, model, store,
            new KerberosPasswordValidator());
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

    // -- UserQueryProvider --------------------------------------------

    @Test
    void search_for_user_stream_delegates_username_param_to_username_lookup() {
        when(store.findByUsername("alice")).thenReturn(Optional.of(ALICE));

        var users = provider.searchForUserStream(realm,
            Map.of(UserModel.USERNAME, "alice"), 0, 100).toList();

        assertThat(users).hasSize(1);
        assertThat(users.get(0).getUsername()).isEqualTo("alice");
    }

    @Test
    void search_for_user_stream_delegates_email_param_to_email_lookup() {
        when(store.findByEmail("alice@example.invalid")).thenReturn(Optional.of(ALICE));

        var users = provider.searchForUserStream(realm,
            Map.of(UserModel.EMAIL, "alice@example.invalid"), 0, 100).toList();

        assertThat(users).hasSize(1);
        assertThat(users.get(0).getUsername()).isEqualTo("alice");
    }

    @Test
    void search_for_user_stream_returns_empty_for_unhandled_params() {
        var users = provider.searchForUserStream(realm,
            Map.of("search", "ali"), 0, 100).toList();

        assertThat(users).isEmpty();
    }

    @Test
    void search_for_user_stream_returns_empty_when_username_misses() {
        when(store.findByUsername("nope")).thenReturn(Optional.empty());

        var users = provider.searchForUserStream(realm,
            Map.of(UserModel.USERNAME, "nope"), 0, 100).toList();

        assertThat(users).isEmpty();
    }

    @Test
    void search_for_user_stream_handles_null_pagination_args() {
        when(store.findByUsername("alice")).thenReturn(Optional.of(ALICE));

        var users = provider.searchForUserStream(realm,
            Map.of(UserModel.USERNAME, "alice"), null, null).toList();

        assertThat(users).hasSize(1);
    }

    @Test
    void search_for_user_by_attribute_returns_empty() {
        var users = provider.searchForUserByUserAttributeStream(
            realm, "department", "engineering").toList();

        assertThat(users).isEmpty();
    }

    @Test
    void get_group_members_stream_returns_empty_in_phase_4() {
        var users = provider.getGroupMembersStream(realm, null, 0, 100).toList();

        assertThat(users).isEmpty();
    }

    // -- cross-realm admission ------------------------------------------
    //
    // The ordering here is the security property: a provisional user is
    // one a trusted foreign realm vouches for, and nothing may be
    // written for them until their home KDC has confirmed the password.
    // Lookup runs for unauthenticated callers, so admitting any earlier
    // would let anyone create principals on the cluster by guessing
    // usernames.

    private static final FactoryPlusUser BOB_PROVISIONAL = new FactoryPlusUser(
        "00000000-0000-0000-0000-0000000000b0",
        "bob@OTHER.REALM",
        null,
        true);

    /** Stands in for the real Kerberos validator, whose {@code validate}
     *  needs a KDC. Records whether it ran so the tests can assert that
     *  the write never happens before the password check. */
    private static final class StubValidator extends KerberosPasswordValidator {
        boolean accept;
        boolean called;

        StubValidator(boolean accept) { this.accept = accept; }

        @Override
        public boolean validate(String upn, String password) {
            called = true;
            return accept;
        }
    }

    private FactoryPlusUserStorageProvider providerWith(StubValidator validator) {
        return new FactoryPlusUserStorageProvider(session, model, store, validator);
    }

    private UserModel provisionalUser() {
        return new FactoryPlusUserAdapter(session, realm, model,
            BOB_PROVISIONAL, store);
    }

    private static CredentialInput password(String value) {
        return new UserCredentialModel(null, PasswordCredentialModel.TYPE, value);
    }

    @Test
    void admit_is_called_after_a_successful_password_check() {
        var validator = new StubValidator(true);

        boolean valid = providerWith(validator)
            .isValid(realm, provisionalUser(), password("hunter2"));

        assertThat(valid).isTrue();
        verify(store).admit(BOB_PROVISIONAL.username(), BOB_PROVISIONAL.uuid());
    }

    @Test
    void admit_is_never_called_when_the_password_check_fails() {
        var validator = new StubValidator(false);

        boolean valid = providerWith(validator)
            .isValid(realm, provisionalUser(), password("wrong"));

        assertThat(valid).isFalse();
        assertThat(validator.called)
            .as("The password must actually have been tested")
            .isTrue();
        verify(store, never()).admit(any(), any());
    }

    @Test
    void admit_is_not_called_for_an_ordinary_local_user() {
        var validator = new StubValidator(true);
        UserModel local = new FactoryPlusUserAdapter(session, realm, model,
            ALICE, store);

        assertThat(providerWith(validator).isValid(realm, local, password("ok")))
            .isTrue();
        verify(store, never()).admit(any(), any());
    }

    @Test
    void is_valid_returns_false_when_admit_throws() {
        // Never issue a session whose identity could not be persisted:
        // the token would carry an fp_principal_uuid that nothing on
        // the cluster recognises, so every F+ service would reject it.
        var validator = new StubValidator(true);
        when(store.admit(any(), any()))
            .thenThrow(new FactoryPlusAuthException("write refused"));

        assertThat(providerWith(validator)
            .isValid(realm, provisionalUser(), password("hunter2")))
            .isFalse();
    }

    @Test
    void unsupported_credential_type_never_reaches_the_validator() {
        var validator = new StubValidator(true);

        assertThat(providerWith(validator).isValid(realm, provisionalUser(),
            new UserCredentialModel(null, "otp", "123456")))
            .isFalse();
        assertThat(validator.called).isFalse();
        verify(store, never()).admit(any(), any());
    }
}
