/* ACS Keycloak SPI
 * Factory id stability test.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FactoryPlusUserStorageProviderFactoryTest {

    @Test
    void factory_id_is_stable() {
        var factory = new FactoryPlusUserStorageProviderFactory();
        assertThat(factory.getId()).isEqualTo("factoryplus");
    }
}
