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
     * Returns the UUIDs of all principal-groups (subclasses of
     * Factory+'s {@code Class.Principal}) containing the given
     * principal, recursively expanded. This populates the
     * {@code fp_groups} JWT claim and drives Grafana role mapping.
     *
     * @return empty Set if the principal exists but isn't in any
     *     group; empty Set if the principal doesn't exist
     *     (callers can't distinguish the two cases - the only thing
     *     the SPI does with this is stamp a claim, where empty=no
     *     groups is correct in both situations)
     */
    Set<String> findGroupsForPrincipal(String uuid);
}
