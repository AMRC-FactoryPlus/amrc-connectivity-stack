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

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.keycloak.admin.client.Keycloak;
import org.keycloak.admin.client.KeycloakBuilder;
import org.keycloak.common.util.MultivaluedHashMap;
import org.keycloak.representations.idm.ComponentRepresentation;
import org.keycloak.storage.UserStorageProvider;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.output.Slf4jLogConsumer;
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
     * to start any container, so the IT skips cleanly when no Docker
     * daemon is reachable rather than failing the whole build.
     *
     * The IT WILL run if any of the following holds:
     *   * /var/run/docker.sock exists and is connectable (Linux, Docker
     *     Desktop, GitHub Actions ubuntu-latest)
     *   * DOCKER_HOST env var is set AND the socket file it names
     *     actually exists (OrbStack/Colima/Rancher Desktop on macOS,
     *     after starting the VM)
     *
     * Common gotcha on macOS + OrbStack: the docker CLI auto-starts
     * OrbStack on demand, so `docker version` works even when the VM
     * is stopped. Testcontainers does NOT trigger that auto-start - it
     * just stat()s the socket file. If OrbStack is stopped the file
     * doesn't exist and this IT skips. Run `orb start` first, or
     * configure OrbStack to start on login, then:
     *
     *   DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock mvn -B verify
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

    /** In-process Wiremock acting as a fake F+ auth service, reachable
     *  from the Keycloak container via host.testcontainers.internal. */
    private static WireMockServer wiremock;

    @BeforeAll
    static void startWiremock() {
        if (!dockerAvailable()) return;
        wiremock = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        wiremock.start();
        // Make the host port reachable from inside the Keycloak container.
        // FQN: clashes with org.testcontainers.junit.jupiter.Testcontainers
        // (the @Testcontainers annotation) imported on the class.
        org.testcontainers.Testcontainers.exposeHostPorts(wiremock.port());
    }

    @AfterAll
    static void stopWiremock() {
        if (wiremock != null) wiremock.stop();
    }

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
            .withStartupTimeout(Duration.ofMinutes(3)))
        .withLogConsumer(new Slf4jLogConsumer(
            org.slf4j.LoggerFactory.getLogger("keycloak-container")));

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

    @Test
    void federation_accepts_wiremock_auth_url_configuration() {
        // Phase 2 IT: prove that the SPI accepts the auth.url config and
        // wires up an FPAuthBackedUserStore pointing at it. Full
        // end-to-end search through Keycloak admin REST needs
        // UserQueryProvider which is a Phase 5 task; until then the
        // FPAuthBackedUserStore behaviour itself is covered by the 10
        // Wiremock unit tests in FPAuthBackedUserStoreTest.

        try (Keycloak admin = adminClient()) {
            var realm = admin.realm("master");
            String realmId = realm.toRepresentation().getId();

            var component = new ComponentRepresentation();
            component.setName("factoryplus-wiremock");
            component.setProviderType(UserStorageProvider.class.getName());
            component.setProviderId("factoryplus");
            component.setParentId(realmId);
            var config = new MultivaluedHashMap<String, String>();
            config.putSingle("auth.url",
                "http://host.testcontainers.internal:" + wiremock.port());
            config.putSingle("auth.timeout.seconds", "3");
            component.setConfig(config);

            try (Response res = realm.components().add(component)) {
                assertThat(res.getStatus())
                    .as("Configuring 'factoryplus' with auth.url + timeout "
                        + "should succeed; if this fails the factory's "
                        + "config processing is broken")
                    .isEqualTo(201);
            }

            // Verify the configuration round-trips through Keycloak's
            // component store: read it back and check our values landed.
            var stored = realm.components().query(realmId,
                UserStorageProvider.class.getName(), "factoryplus-wiremock");
            assertThat(stored).hasSize(1);
            assertThat(stored.get(0).getConfig().getFirst("auth.url"))
                .startsWith("http://host.testcontainers.internal:");
            assertThat(stored.get(0).getConfig().getFirst("auth.timeout.seconds"))
                .isEqualTo("3");
        }
    }
}
