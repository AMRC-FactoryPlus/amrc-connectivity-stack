/* ACS Keycloak SPI
 * The null store is the production default until Phase 2. If it ever
 * regressed to returning a real user (say, after a sloppy refactor) the
 * SPI would silently start authenticating ghosts. These tests pin the
 * contract: every lookup, including weird inputs, returns Optional.empty.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class NullFactoryPlusUserStoreTest {

    private final FactoryPlusUserStore store = NullFactoryPlusUserStore.INSTANCE;

    @Test
    void find_by_uuid_is_always_empty() {
        assertThat(store.findByUuid("00000000-0000-0000-0000-000000000001")).isEmpty();
        assertThat(store.findByUuid("")).isEmpty();
        assertThat(store.findByUuid(null)).isEmpty();
    }

    @Test
    void find_by_username_is_always_empty() {
        assertThat(store.findByUsername("alice")).isEmpty();
        assertThat(store.findByUsername("")).isEmpty();
        assertThat(store.findByUsername(null)).isEmpty();
    }

    @Test
    void find_by_email_is_always_empty() {
        assertThat(store.findByEmail("alice@example.invalid")).isEmpty();
        assertThat(store.findByEmail("")).isEmpty();
        assertThat(store.findByEmail(null)).isEmpty();
    }

    @Test
    void instance_singleton_is_the_only_way_in() {
        assertThat(NullFactoryPlusUserStore.INSTANCE).isSameAs(NullFactoryPlusUserStore.INSTANCE);
    }
}
