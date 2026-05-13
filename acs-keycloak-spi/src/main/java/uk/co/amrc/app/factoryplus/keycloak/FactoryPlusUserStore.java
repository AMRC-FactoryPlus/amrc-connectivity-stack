/* ACS Keycloak SPI
 * Read-only abstraction over the source of truth for users (Factory+
 * auth service). The provider depends on this interface, not on any
 * specific implementation, so unit tests can mock it and Phase 2 can
 * slot in a real HTTP-backed implementation behind it without touching
 * the provider.
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
}
