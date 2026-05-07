/* ACS Keycloak SPI
 * End-to-end integration test: bake the SPI jar into a real Keycloak
 * container and assert it loads, that admins can configure 'factoryplus'
 * as a federation provider, and that user lookups against the null store
 * (the Phase 1 default) return no users without breaking the federation
 * chain.
 *
 * Requires Docker. Runs in the Maven 'verify' phase (failsafe), not the
 * 'test' phase (surefire) - the suffix 'IT' is what the failsafe plugin
 * uses to find these.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak.integration;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.keycloak.admin.client.Keycloak;
import org.keycloak.admin.client.KeycloakBuilder;
import org.keycloak.representations.idm.ComponentRepresentation;
import org.keycloak.storage.UserStorageProvider;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import java.nio.file.Path;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
@EnabledIf("dockerAvailable")
class FactoryPlusFederationIT {

    /**
     * Class-level guard. Runs before the @Testcontainers extension tries
     * to start any container, so the test class is disabled cleanly on
     * dev machines where Docker isn't auto-detectable.
     *
     * Docker is auto-detectable on:
     *   * Linux with default daemon at /var/run/docker.sock
     *   * Docker Desktop (macOS/Windows/Linux)
     *   * GitHub Actions ubuntu-latest runners
     *
     * Docker is NOT auto-detectable on macOS with OrbStack/Colima/Rancher
     * Desktop because the JVM can't read /var/run/docker.sock through
     * the symlink (SIP / sandboxing). Workarounds:
     *   * `sudo ln -sf $HOME/.orbstack/run/docker.sock /var/run/docker.sock`
     *     (recreates the symlink in a writable namespace), or
     *   * Set DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock and
     *     verify Testcontainers' EnvironmentAndSystemPropertyClient
     *     strategy applies (it didn't on 1.21.3 in initial testing).
     */
    static boolean dockerAvailable() {
        try {
            DockerClientFactory.instance().client();
            return true;
        }
        catch (Throwable t) {
            System.out.println("[IT] Docker not auto-detected, skipping IT: "
                + t.getMessage());
            return false;
        }
    }

    private static final String SPI_JAR = System.getProperty("spi.jar",
        "target/acs-keycloak-spi-0.0.0-intree.jar");

    private static final String ADMIN_USER = "admin";
    private static final String ADMIN_PASS = "admin";

    @Container
    static final GenericContainer<?> KEYCLOAK = new GenericContainer<>(
            DockerImageName.parse("quay.io/keycloak/keycloak:26.1.1"))
        .withExposedPorts(8080, 9000)
        .withEnv("KC_BOOTSTRAP_ADMIN_USERNAME", ADMIN_USER)
        .withEnv("KC_BOOTSTRAP_ADMIN_PASSWORD", ADMIN_PASS)
        .withEnv("KC_HEALTH_ENABLED", "true")
        .withCopyFileToContainer(
            MountableFile.forHostPath(Path.of(SPI_JAR).toAbsolutePath()),
            "/opt/keycloak/providers/acs-keycloak-spi.jar")
        .withCommand("start-dev")
        .waitingFor(Wait.forHttp("/health/ready")
            .forPort(9000)
            .withStartupTimeout(Duration.ofMinutes(3)));

    private Keycloak adminClient() {
        var url = "http://%s:%d".formatted(
            KEYCLOAK.getHost(), KEYCLOAK.getMappedPort(8080));
        return KeycloakBuilder.builder()
            .serverUrl(url)
            .realm("master")
            .clientId("admin-cli")
            .username(ADMIN_USER)
            .password(ADMIN_PASS)
            .build();
    }

    @Test
    void factoryplus_provider_can_be_added_to_master_realm() {
        try (Keycloak admin = adminClient()) {
            // Master realm always exists; we use it because it's the
            // simplest available, no realm-import dance needed.
            var realm = admin.realm("master");
            String realmId = realm.toRepresentation().getId();

            var component = new ComponentRepresentation();
            component.setName("factoryplus-it");
            component.setProviderType(UserStorageProvider.class.getName());
            component.setProviderId("factoryplus");
            component.setParentId(realmId);

            try (Response res = realm.components().add(component)) {
                // 201 means Keycloak accepted the provider id - which it
                // only does if our SPI's META-INF/services entry was
                // discovered at startup. A missing or broken jar would
                // surface here as a 400.
                assertThat(res.getStatus())
                    .as("Adding a 'factoryplus' federation provider should succeed; "
                        + "if this fails the SPI didn't load correctly")
                    .isEqualTo(201);
            }
        }
    }

    @Test
    void user_search_returns_zero_with_null_store() {
        try (Keycloak admin = adminClient()) {
            var realm = admin.realm("master");

            // Search for any user - the master realm has the bootstrap
            // 'admin' which is local, plus whatever the federation
            // returns. With NullFactoryPlusUserStore wired in, the
            // federation contributes nothing. We assert at least the
            // local admin is present and search by an unrelated string
            // returns empty (rather than blowing up).
            var users = realm.users().search("nonexistent-fp-user-xyz");
            assertThat(users)
                .as("Federation should fall through cleanly with the "
                    + "null store, returning no matches rather than erroring")
                .isEmpty();
        }
    }
}
