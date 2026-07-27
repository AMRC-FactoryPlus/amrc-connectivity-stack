/* ACS Keycloak SPI
 * Abstraction over the source of truth for users (Factory+ auth
 * service). The provider depends on this interface, not on any specific
 * implementation, so unit tests can mock it and Phase 2 can slot in a
 * real HTTP-backed implementation behind it without touching the
 * provider.
 *
 * Lookups are read-only. The single write on this interface is
 * `admit`, which persists a cross-realm user's Kerberos identity after
 * their password has been validated against their home KDC.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import java.util.Optional;
import java.util.Set;

public interface FactoryPlusUserStore {

    Optional<FactoryPlusUser> findByUuid(String uuid);

    Optional<FactoryPlusUser> findByUsername(String username);

    Optional<FactoryPlusUser> findByEmail(String email);

    /**
     * Returns the UUIDs of permissions held by the given principal
     * with target=Wildcard. These populate the {@code fp_permissions}
     * JWT claim and drive Grafana role mapping (and any future OIDC
     * consumer's role logic).
     *
     * <p>Wildcard-targeted permissions are the F+ analogue of "global
     * roles": the principal has the permission against any object.
     * Targeted grants ({@code (perm, obj-uuid)}) are intentionally
     * excluded - the JWT carries roles only.
     *
     * @return empty Set if the principal exists but has no Wildcard
     *     grants; empty Set if the principal doesn't exist.
     */
    Set<String> findPermissionsForPrincipal(String uuid);

    /**
     * Persist a Kerberos identity for a cross-realm user, creating the
     * local Factory+ principal if it doesn't exist.
     *
     * <p>This is the only write on the store, and it is called from
     * exactly one place: {@code FactoryPlusUserStorageProvider.isValid},
     * after the KDC has confirmed the user's password. Calling it
     * anywhere earlier would let an unauthenticated caller create
     * principals on the cluster by guessing usernames.
     *
     * <p>The write is a {@code PUT /v2/principal/{uuid}/kerberos},
     * guarded server-side by the {@code WriteKrb} permission on the
     * target UUID. The mirrored principal gets no ConfigDB
     * {@code Info} name, so it appears in the ACL editor by its UPN.
     *
     * @param upn the fully qualified Kerberos principal name to store
     * @param uuid the principal UUID to write against, or null to mint
     *     a fresh random one
     * @return the UUID the identity was written against
     * @throws FactoryPlusAuthException if the write fails. The caller
     *     must reject the login rather than issue a session whose
     *     fp_principal_uuid nothing on the cluster recognises.
     */
    String admit(String upn, String uuid);
}
