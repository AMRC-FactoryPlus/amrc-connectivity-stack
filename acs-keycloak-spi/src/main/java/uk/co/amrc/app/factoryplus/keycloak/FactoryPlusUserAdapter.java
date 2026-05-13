/* ACS Keycloak SPI
 * Adapts an immutable FactoryPlusUser DTO as Keycloak's UserModel.
 *
 * Extends AbstractUserAdapter so we inherit no-op defaults for the 30+
 * UserModel methods we don't care about (role mappings, required actions,
 * federation links, etc.). We override only the fields backed by F+
 * data: username, email, and the storage id (which uses the F+ UUID
 * rather than the username, so renames don't invalidate existing
 * Keycloak references).
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.keycloak.component.ComponentModel;
import org.keycloak.credential.UserCredentialManager;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.SubjectCredentialManager;
import org.keycloak.models.UserModel;
import org.keycloak.storage.StorageId;
import org.keycloak.storage.adapter.AbstractUserAdapter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;
import org.keycloak.common.util.MultivaluedHashMap;

public class FactoryPlusUserAdapter extends AbstractUserAdapter {

    private final ComponentModel componentModel;
    private final FactoryPlusUser user;
    private final FactoryPlusUserStore store;

    public FactoryPlusUserAdapter(KeycloakSession session, RealmModel realm,
                                  ComponentModel componentModel,
                                  FactoryPlusUser user,
                                  FactoryPlusUserStore store) {
        super(session, realm, componentModel);
        this.componentModel = componentModel;
        this.user = user;
        this.store = store;
    }

    @Override
    public String getUsername() {
        return user.username();
    }

    @Override
    public String getEmail() {
        // F+ has no email field. Fall back to the UPN, which is
        // syntactically email-shaped and unique-per-user. This is the
        // only realistic value we can give Keycloak so downstream
        // consumers (e.g. Grafana, which 500s when email is missing)
        // stop probing GitHub-style /userinfo/emails fallbacks.
        if (user.email() != null && !user.email().isBlank()) return user.email();
        return user.username();
    }

    @Override
    public String getId() {
        // External id is the F+ UUID, not the username, so a rename in F+
        // doesn't invalidate Keycloak references that hold the storage id.
        return StorageId.keycloakId(componentModel, user.uuid());
    }

    /**
     * Convenience accessor for callers (e.g. claim mappers in Phase 7) that
     * need the underlying F+ UUID without parsing the storage id.
     */
    public String getFactoryPlusUuid() {
        return user.uuid();
    }

    /**
     * The set of F+ permission UUIDs (target=Wildcard) held by this
     * user, used by the {@code fp_permissions} OIDC claim mapper.
     * Delegates to the store so results come from the cache layer.
     */
    public Set<String> getFactoryPlusPermissions() {
        return store.findPermissionsForPrincipal(user.uuid());
    }

    /** Expose the F+ UUID and Wildcard-permission UUIDs as Keycloak
     *  user attributes so the protocol mappers can read them via the
     *  standard attribute API. {@code instanceof FactoryPlusUserAdapter}
     *  doesn't work at token-issuance time because Keycloak's
     *  UserCacheSession wraps us in its own UserAdapter; attributes
     *  survive that wrapping (and the cache itself). */
    public static final String ATTR_FP_UUID = "fp_principal_uuid";
    public static final String ATTR_FP_PERMISSIONS = "fp_permissions";

    @Override
    public Map<String, List<String>> getAttributes() {
        // Start from the parent so standard attributes (username,
        // email, firstName, lastName) are preserved - overriding from
        // scratch here masked username/email and made userinfo return
        // them as null. Then layer the F+ extras on top.
        MultivaluedHashMap<String, String> attrs = new MultivaluedHashMap<>();
        Map<String, List<String>> base = super.getAttributes();
        if (base != null) attrs.putAll(base);
        attrs.add(ATTR_FP_UUID, user.uuid());
        for (String g : store.findPermissionsForPrincipal(user.uuid())) {
            attrs.add(ATTR_FP_PERMISSIONS, g);
        }
        return attrs;
    }

    @Override
    public Stream<String> getAttributeStream(String name) {
        if (ATTR_FP_UUID.equals(name)) return Stream.of(user.uuid());
        if (ATTR_FP_PERMISSIONS.equals(name))
            return store.findPermissionsForPrincipal(user.uuid()).stream();
        // Expose username/email through the per-name attribute API
        // explicitly. Keycloak's AbstractUserAdapter.getAttributeStream
        // only surfaces *stored* attributes - it does NOT route
        // "username"/"email" to getUsername/getEmail. The standard
        // oidc-usermodel-attribute-mapper looks them up via this API,
        // so without these branches preferred_username and email come
        // out as null in the issued tokens / userinfo. The default
        // user-cache wrapper masks this because it snapshots
        // getAttributes() (which we *do* implement correctly via
        // super); cachePolicy=NO_CACHE bypasses the cache and exposes
        // the bug.
        if (UserModel.USERNAME.equals(name)) return Stream.of(getUsername());
        if (UserModel.EMAIL.equals(name)) {
            String e = getEmail();
            return e == null ? Stream.empty() : Stream.of(e);
        }
        return super.getAttributeStream(name);
    }

    @Override
    public String getFirstAttribute(String name) {
        if (ATTR_FP_UUID.equals(name)) return user.uuid();
        if (ATTR_FP_PERMISSIONS.equals(name)) {
            return store.findPermissionsForPrincipal(user.uuid())
                .stream().findFirst().orElse(null);
        }
        if (UserModel.USERNAME.equals(name)) return getUsername();
        if (UserModel.EMAIL.equals(name))    return getEmail();
        return super.getFirstAttribute(name);
    }

    @Override
    public SubjectCredentialManager credentialManager() {
        // Standard plumbing: routes credential validation back through any
        // CredentialInputValidator the SPI implements. Phase 1 has none, so
        // any credential check returns false. Phase 6 wires in the Kerberos
        // delegate.
        return new UserCredentialManager(session, realm, this);
    }
}
