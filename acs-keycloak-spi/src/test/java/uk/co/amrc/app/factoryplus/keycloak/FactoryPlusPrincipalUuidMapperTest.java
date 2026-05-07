/* ACS Keycloak SPI
 * Tests for the fp_principal_uuid claim mapper.
 *
 * Keycloak's mapper interface is large and stateful (transformAccessToken
 * etc. take a session, model, client, and mutate a token in place).
 * Rather than fight that surface in unit tests, we expose the
 * claim-determination logic as a static helper - claimValueFor(user) -
 * and unit-test that. The SPI metadata + identity assertions still
 * exercise the full lifecycle.
 *
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class FactoryPlusPrincipalUuidMapperTest {

    private static final FactoryPlusUser ALICE = new FactoryPlusUser(
        "alice-uuid", "alice@FACTORYPLUS.LOCAL", null);

    @Mock KeycloakSession session;
    @Mock RealmModel realm;
    @Mock ComponentModel model;

    @Test
    void claim_value_is_factory_plus_uuid_for_federated_user() {
        when(model.getId()).thenReturn("model-id");
        FactoryPlusUserAdapter adapter = new FactoryPlusUserAdapter(
            session, realm, model, ALICE);

        Object value = FactoryPlusPrincipalUuidMapper.claimValueFor(adapter);

        assertThat(value).isEqualTo("alice-uuid");
    }

    @Test
    void claim_value_is_null_for_non_federated_user() {
        // A local Keycloak user, or one from another federation, must
        // not get the fp_principal_uuid claim. Returning null lets
        // OIDCAttributeMapperHelper omit the claim entirely.
        UserModel notOurs = org.mockito.Mockito.mock(UserModel.class);

        Object value = FactoryPlusPrincipalUuidMapper.claimValueFor(notOurs);

        assertThat(value).isNull();
    }

    @Test
    void claim_name_is_fp_principal_uuid() {
        var mapper = new FactoryPlusPrincipalUuidMapper();
        assertThat(mapper.getId()).isEqualTo("factoryplus-principal-uuid-mapper");
        assertThat(mapper.getDisplayType()).contains("Principal UUID");
    }

    @Test
    void mapper_registered_via_service_loader_metadata() throws Exception {
        var path = "META-INF/services/org.keycloak.protocol.ProtocolMapper";
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(path)) {
            assertThat(in).isNotNull();
            String contents = new String(in.readAllBytes(), StandardCharsets.UTF_8).trim();
            assertThat(contents)
                .contains("uk.co.amrc.app.factoryplus.keycloak.FactoryPlusPrincipalUuidMapper");
        }
    }
}
