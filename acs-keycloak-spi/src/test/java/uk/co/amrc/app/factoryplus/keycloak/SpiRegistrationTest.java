/* ACS Keycloak SPI
 * Asserts the ServiceLoader metadata that makes Keycloak discover our
 * factory at startup is present on the classpath.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class SpiRegistrationTest {

    private static final String SPI_RESOURCE =
        "META-INF/services/org.keycloak.storage.UserStorageProviderFactory";

    @Test
    void factory_is_registered_via_service_loader_metadata() throws Exception {
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(SPI_RESOURCE)) {
            assertThat(in)
                .as("SPI registration file %s must exist on the classpath", SPI_RESOURCE)
                .isNotNull();
            String contents = new String(in.readAllBytes(), StandardCharsets.UTF_8).trim();
            assertThat(contents)
                .isEqualTo("uk.co.amrc.app.factoryplus.keycloak.FactoryPlusUserStorageProviderFactory");
        }
    }
}
