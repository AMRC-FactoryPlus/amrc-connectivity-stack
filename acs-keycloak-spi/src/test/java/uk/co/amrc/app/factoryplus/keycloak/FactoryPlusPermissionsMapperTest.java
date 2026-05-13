/* ACS Keycloak SPI
 * Tests for the fp_groups claim mapper. Mirrors
 * FactoryPlusPrincipalUuidMapperTest's pattern - the claim
 * determination is exposed as a static helper so we can test it
 * without driving Keycloak's full protocol-mapper transform machinery.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

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

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class FactoryPlusPermissionsMapperTest {

    private static final FactoryPlusUser ALICE = new FactoryPlusUser(
        "alice-uuid", "alice@FACTORYPLUS.LOCAL", null);

    @Mock KeycloakSession session;
    @Mock RealmModel realm;
    @Mock ComponentModel model;

    @Test
    @SuppressWarnings("unchecked")
    void claim_value_is_list_of_group_uuids_for_federated_user() {
        when(model.getId()).thenReturn("model-id");
        var store = new StubGroupsStore(Set.of("g-editor", "g-viewer"));
        var adapter = new FactoryPlusUserAdapter(session, realm, model, ALICE, store);

        Object value = FactoryPlusPermissionsMapper.claimValueFor(adapter);

        assertThat(value).isInstanceOf(List.class);
        assertThat((List<String>) value).containsExactlyInAnyOrder("g-editor", "g-viewer");
    }

    @Test
    @SuppressWarnings("unchecked")
    void claim_value_is_empty_list_for_federated_user_in_no_groups() {
        // Empty list is meaningful - the user IS federated, just not in
        // any groups - so the claim still fires (with empty array).
        when(model.getId()).thenReturn("model-id");
        var store = new StubGroupsStore(Set.of());
        var adapter = new FactoryPlusUserAdapter(session, realm, model, ALICE, store);

        Object value = FactoryPlusPermissionsMapper.claimValueFor(adapter);

        assertThat(value).isInstanceOf(List.class);
        assertThat((List<String>) value).isEmpty();
    }

    @Test
    void claim_value_is_null_for_non_federated_user() {
        UserModel notOurs = mock(UserModel.class);

        Object value = FactoryPlusPermissionsMapper.claimValueFor(notOurs);

        assertThat(value).isNull();
    }

    @Test
    void mapper_id_and_display_type_are_correct() {
        var mapper = new FactoryPlusPermissionsMapper();
        assertThat(mapper.getId()).isEqualTo("factoryplus-permissions-mapper");
        assertThat(mapper.getDisplayType()).contains("Permissions");
    }

    @Test
    void mapper_registered_via_service_loader_metadata() throws Exception {
        var path = "META-INF/services/org.keycloak.protocol.ProtocolMapper";
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(path)) {
            assertThat(in).isNotNull();
            String contents = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            assertThat(contents)
                .contains("uk.co.amrc.app.factoryplus.keycloak.FactoryPlusPermissionsMapper");
        }
    }

    /** Minimal store stub that returns a fixed group set. */
    private static final class StubGroupsStore implements FactoryPlusUserStore {
        private final Set<String> groups;
        StubGroupsStore(Set<String> g) { this.groups = g; }
        @Override public Optional<FactoryPlusUser> findByUuid(String u) { return Optional.empty(); }
        @Override public Optional<FactoryPlusUser> findByUsername(String n) { return Optional.empty(); }
        @Override public Optional<FactoryPlusUser> findByEmail(String e) { return Optional.empty(); }
        @Override public Set<String> findPermissionsForPrincipal(String u) { return groups; }
    }
}
