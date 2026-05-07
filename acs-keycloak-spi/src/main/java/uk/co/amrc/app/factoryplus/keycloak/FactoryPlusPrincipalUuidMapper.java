/* ACS Keycloak SPI
 * OIDC protocol mapper that stamps the F+ principal UUID into JWTs
 * (access token, id token, userinfo) under the claim name
 * 'fp_principal_uuid'.
 *
 * Phase 7's first claim. Phase 9 (or later) adds fp_groups and
 * fp_classes once F+ exposes the underlying data; the claim names are
 * documented as public API in the pitch.
 *
 * Only fires for users sourced from this federation - a Keycloak local
 * user or one from another federation has no fp UUID, so the claim is
 * omitted from their tokens.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.keycloak.models.ClientSessionContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.ProtocolMapperModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.UserSessionModel;
import org.keycloak.protocol.oidc.mappers.AbstractOIDCProtocolMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAccessTokenMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAttributeMapperHelper;
import org.keycloak.protocol.oidc.mappers.OIDCIDTokenMapper;
import org.keycloak.protocol.oidc.mappers.TokenIntrospectionTokenMapper;
import org.keycloak.protocol.oidc.mappers.UserInfoTokenMapper;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.representations.IDToken;

import java.util.ArrayList;
import java.util.List;

public class FactoryPlusPrincipalUuidMapper extends AbstractOIDCProtocolMapper
        implements OIDCAccessTokenMapper, OIDCIDTokenMapper,
                   UserInfoTokenMapper, TokenIntrospectionTokenMapper {

    public static final String PROVIDER_ID = "factoryplus-principal-uuid-mapper";
    public static final String CLAIM_NAME  = "fp_principal_uuid";

    private static final List<ProviderConfigProperty> CONFIG_PROPERTIES = new ArrayList<>();
    static {
        // Standard plumbing: lets admins toggle access/id/userinfo
        // inclusion for the claim. The claim name itself is fixed by
        // PROVIDER_ID so consumers can rely on it.
        OIDCAttributeMapperHelper.addIncludeInTokensConfig(
            CONFIG_PROPERTIES, FactoryPlusPrincipalUuidMapper.class);
    }

    @Override
    public String getDisplayCategory() {
        return TOKEN_MAPPER_CATEGORY;
    }

    @Override
    public String getDisplayType() {
        return "Factory+ Principal UUID";
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getHelpText() {
        return "Stamps the Factory+ principal UUID into the '"
            + CLAIM_NAME + "' claim. Fires only for users sourced from "
            + "the factoryplus user federation.";
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return CONFIG_PROPERTIES;
    }

    @Override
    protected void setClaim(IDToken token, ProtocolMapperModel mappingModel,
                            UserSessionModel userSession,
                            KeycloakSession keycloakSession,
                            ClientSessionContext clientSessionCtx) {
        Object value = claimValueFor(userSession.getUser());
        if (value == null) return;
        // OIDCAttributeMapperHelper handles claim-name resolution
        // (default to CLAIM_NAME, configurable per mapper instance) and
        // include-in-token toggles.
        mappingModel.getConfig().putIfAbsent(
            OIDCAttributeMapperHelper.TOKEN_CLAIM_NAME, CLAIM_NAME);
        OIDCAttributeMapperHelper.mapClaim(token, mappingModel, value);
    }

    /**
     * Returns the claim value for {@code user}, or null if the user
     * isn't from this federation. Public + static so unit tests can
     * cover claim determination without needing to drive Keycloak's
     * full session/transform machinery.
     */
    public static Object claimValueFor(UserModel user) {
        if (user instanceof FactoryPlusUserAdapter adapter) {
            return adapter.getFactoryPlusUuid();
        }
        return null;
    }
}
