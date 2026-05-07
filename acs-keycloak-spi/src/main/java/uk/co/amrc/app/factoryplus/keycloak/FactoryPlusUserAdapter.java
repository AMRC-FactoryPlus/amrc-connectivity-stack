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
import org.keycloak.storage.StorageId;
import org.keycloak.storage.adapter.AbstractUserAdapter;

import java.util.Set;

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
        return user.email();
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
     * The set of F+ principal-groups containing this user, used by the
     * {@code fp_groups} OIDC claim mapper. Delegates to the store so
     * results come from the cache layer (group lookups are an HTTP
     * round-trip otherwise).
     */
    public Set<String> getFactoryPlusGroups() {
        return store.findGroupsForPrincipal(user.uuid());
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
