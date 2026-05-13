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
import org.keycloak.credential.CredentialInput;
import org.keycloak.credential.CredentialInputValidator;
import org.keycloak.models.GroupModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.credential.PasswordCredentialModel;
import org.keycloak.storage.StorageId;
import org.keycloak.storage.UserStorageProvider;
import org.keycloak.storage.user.UserLookupProvider;
import org.keycloak.storage.user.UserQueryProvider;

import java.util.Map;
import java.util.stream.Stream;

public class FactoryPlusUserStorageProvider
        implements UserStorageProvider, UserLookupProvider, UserQueryProvider,
                   CredentialInputValidator {

    private final KeycloakSession session;
    private final ComponentModel model;
    private final FactoryPlusUserStore store;
    private final KerberosPasswordValidator passwordValidator;

    public FactoryPlusUserStorageProvider(KeycloakSession session,
                                          ComponentModel model,
                                          FactoryPlusUserStore store,
                                          KerberosPasswordValidator passwordValidator) {
        this.session = session;
        this.model = model;
        this.store = store;
        this.passwordValidator = passwordValidator;
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
            .map(u -> new FactoryPlusUserAdapter(session, realm, model, u, store))
            .orElse(null);
    }

    @Override
    public UserModel getUserByUsername(RealmModel realm, String username) {
        return store.findByUsername(username)
            .map(u -> new FactoryPlusUserAdapter(session, realm, model, u, store))
            .orElse(null);
    }

    @Override
    public UserModel getUserByEmail(RealmModel realm, String email) {
        return store.findByEmail(email)
            .map(u -> new FactoryPlusUserAdapter(session, realm, model, u, store))
            .orElse(null);
    }

    // -- UserQueryProvider --------------------------------------------
    //
    // Three abstract methods on UserQueryMethodsProvider must be
    // implemented. We deliberately leave UserCountMethodsProvider's
    // default methods alone; overriding them broke admin REST searches
    // in an earlier attempt (caused HTTP 400 from the admin endpoint,
    // root cause unidentified - likely an interaction between Keycloak's
    // pagination and a 0-count override).

    @Override
    public Stream<UserModel> searchForUserStream(RealmModel realm,
            Map<String, String> params, Integer first, Integer max) {
        // Keycloak's admin REST and login flows query us with a Map of
        // criteria. We handle the two single-criterion cases the
        // FactoryPlusUserStore can answer cheaply (exact username,
        // exact email); free-text search and other params fall through
        // empty until Phase 5 introduces a richer F+ search endpoint.
        String username = params.get(UserModel.USERNAME);
        if (username != null) {
            UserModel user = getUserByUsername(realm, username);
            return user == null ? Stream.empty() : Stream.of(user);
        }
        String email = params.get(UserModel.EMAIL);
        if (email != null) {
            UserModel user = getUserByEmail(realm, email);
            return user == null ? Stream.empty() : Stream.of(user);
        }
        return Stream.empty();
    }

    @Override
    public Stream<UserModel> searchForUserByUserAttributeStream(RealmModel realm,
            String attrName, String attrValue) {
        // F+ has no concept of arbitrary user attributes today. Phase 5
        // could light this up if F+ exposes attributes via ConfigDB.
        return Stream.empty();
    }

    @Override
    public Stream<UserModel> getGroupMembersStream(RealmModel realm,
            GroupModel group, Integer first, Integer max) {
        // Phase 5 implements group membership; until then no federated
        // users appear in any group.
        return Stream.empty();
    }

    // -- CredentialInputValidator ------------------------------------
    //
    // We only support PASSWORD; SPNEGO/Negotiate flows go through
    // Keycloak's Kerberos authenticator separately.

    @Override
    public boolean supportsCredentialType(String credentialType) {
        return PasswordCredentialModel.TYPE.equals(credentialType);
    }

    @Override
    public boolean isConfiguredFor(RealmModel realm, UserModel user, String credentialType) {
        // Every federated user can be challenged for a password (we
        // delegate validation to KDC at challenge time).
        return supportsCredentialType(credentialType);
    }

    @Override
    public boolean isValid(RealmModel realm, UserModel user, CredentialInput input) {
        if (!supportsCredentialType(input.getType())) return false;
        // The username Keycloak stored for this UserModel is the F+
        // kerberos UPN (set by FactoryPlusUserAdapter).
        return passwordValidator.validate(user.getUsername(), input.getChallengeResponse());
    }

    @Override
    public void close() {
        // No resources to release. The store is owned by the factory and
        // shared across providers; this per-request provider doesn't own
        // it.
    }
}
