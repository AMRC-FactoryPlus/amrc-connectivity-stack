/* ACS Keycloak SPI
 * Per-request provider instance. Held by Keycloak for the lifetime of one
 * request (or one transaction); released via close().
 *
 * Implements UserLookupProvider by delegating to a FactoryPlusUserStore.
 * The store abstraction means this class never touches HTTP, JSON, or
 * Kerberos directly - those concerns live behind the interface and arrive
 * via constructor injection. Phase 2 swaps the production wiring from
 * NullFactoryPlusUserStore to a real F+-backed implementation without
 * any change here.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.storage.StorageId;
import org.keycloak.storage.UserStorageProvider;
import org.keycloak.storage.user.UserLookupProvider;

public class FactoryPlusUserStorageProvider
        implements UserStorageProvider, UserLookupProvider {

    private final KeycloakSession session;
    private final ComponentModel model;
    private final FactoryPlusUserStore store;

    public FactoryPlusUserStorageProvider(KeycloakSession session,
                                          ComponentModel model,
                                          FactoryPlusUserStore store) {
        this.session = session;
        this.model = model;
        this.store = store;
    }

    /** Test-only accessor; lets factory tests assert which store
     *  implementation got wired in based on configuration. */
    FactoryPlusUserStore getStore() {
        return store;
    }

    @Override
    public UserModel getUserById(RealmModel realm, String id) {
        // Keycloak passes a federated storage id "f:<modelId>:<externalId>".
        // The external id, by our convention in the adapter, is the F+ UUID.
        String uuid = StorageId.externalId(id);
        return store.findByUuid(uuid)
            .map(u -> new FactoryPlusUserAdapter(session, realm, model, u))
            .orElse(null);
    }

    @Override
    public UserModel getUserByUsername(RealmModel realm, String username) {
        return store.findByUsername(username)
            .map(u -> new FactoryPlusUserAdapter(session, realm, model, u))
            .orElse(null);
    }

    @Override
    public UserModel getUserByEmail(RealmModel realm, String email) {
        return store.findByEmail(email)
            .map(u -> new FactoryPlusUserAdapter(session, realm, model, u))
            .orElse(null);
    }

    @Override
    public void close() {
        // No resources to release. The store is owned by the factory and
        // shared across providers; this per-request provider doesn't own
        // it.
    }
}
