/* ACS Keycloak SPI
 * OIDC protocol mapper that stamps the F+ principal-groups containing
 * the user into JWTs (access token, id token, userinfo) under the
 * claim name 'fp_groups'.
 *
 * This is the load-bearing claim of the pitch: Grafana (and future
 * northbound consumers) read fp_groups from the JWT and translate it
 * into per-app roles via JMESPath role_attribute_path. Without it,
 * F+ ACL grants don't drive Grafana access; with it, granting a user
 * the "Grafana Editor" group in F+ immediately changes their Grafana
 * role on next login (modulo cache TTL).
 *
 * Only fires for users sourced from this federation - a Keycloak local
 * user or one from another federation has no F+ groups, so the claim
 * is omitted from their tokens.
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
import java.util.Set;

public class FactoryPlusGroupsMapper extends AbstractOIDCProtocolMapper
        implements OIDCAccessTokenMapper, OIDCIDTokenMapper,
                   UserInfoTokenMapper, TokenIntrospectionTokenMapper {

    public static final String PROVIDER_ID = "factoryplus-groups-mapper";
    public static final String CLAIM_NAME  = "fp_groups";

    private static final List<ProviderConfigProperty> CONFIG_PROPERTIES = new ArrayList<>();
    static {
        OIDCAttributeMapperHelper.addIncludeInTokensConfig(
            CONFIG_PROPERTIES, FactoryPlusGroupsMapper.class);
    }

    @Override public String getDisplayCategory() { return TOKEN_MAPPER_CATEGORY; }
    @Override public String getDisplayType()     { return "Factory+ Groups"; }
    @Override public String getId()              { return PROVIDER_ID; }

    @Override
    public String getHelpText() {
        return "Stamps the array of Factory+ principal-group UUIDs containing "
            + "the user into the '" + CLAIM_NAME + "' claim. Fires only for "
            + "users sourced from the factoryplus user federation. Empty array "
            + "if the user is in no groups.";
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
        mappingModel.getConfig().putIfAbsent(
            OIDCAttributeMapperHelper.TOKEN_CLAIM_NAME, CLAIM_NAME);
        OIDCAttributeMapperHelper.mapClaim(token, mappingModel, value);
    }

    /**
     * Returns the claim value (a List of group UUIDs) for {@code user},
     * or null if the user isn't from this federation.
     *
     * <p>Public + static so unit tests can cover claim determination
     * without driving Keycloak's full transform machinery.
     */
    public static Object claimValueFor(UserModel user) {
        if (!(user instanceof FactoryPlusUserAdapter adapter)) return null;
        Set<String> groups = adapter.getFactoryPlusGroups();
        // OIDCAttributeMapperHelper expects List for array claims.
        return List.copyOf(groups);
    }
}
