/* ACS Keycloak SPI
 * Null Object implementation of FactoryPlusUserStore: every lookup
 * returns Optional.empty(). Used by the factory as the production
 * default until Phase 2 wires in the real HTTP-backed store. Lets
 * Keycloak boot with the federation provider configured but no F+
 * dependency, useful for testing the SPI loads cleanly without any
 * F+ infrastructure.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import java.util.Optional;
import java.util.Set;

public final class NullFactoryPlusUserStore implements FactoryPlusUserStore {

    public static final NullFactoryPlusUserStore INSTANCE = new NullFactoryPlusUserStore();

    private NullFactoryPlusUserStore() {
    }

    @Override
    public Optional<FactoryPlusUser> findByUuid(String uuid) {
        return Optional.empty();
    }

    @Override
    public Optional<FactoryPlusUser> findByUsername(String username) {
        return Optional.empty();
    }

    @Override
    public Optional<FactoryPlusUser> findByEmail(String email) {
        return Optional.empty();
    }

    @Override
    public Set<String> findPermissionsForPrincipal(String uuid) {
        return Set.of();
    }

    @Override
    public String admit(String upn, String uuid) {
        // Unreachable in practice: every lookup returns empty, so no
        // provisional user is ever produced for the provider to admit.
        // Fail loudly rather than pretending the write happened - a
        // silent success would issue a session whose principal doesn't
        // exist anywhere.
        throw new FactoryPlusAuthException(
            "Cannot admit " + upn + ": no Factory+ auth service is configured");
    }
}
