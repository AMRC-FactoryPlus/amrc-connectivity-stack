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

public interface FactoryPlusUserStore {

    Optional<FactoryPlusUser> findByUuid(String uuid);

    Optional<FactoryPlusUser> findByUsername(String username);

    Optional<FactoryPlusUser> findByEmail(String email);
}
