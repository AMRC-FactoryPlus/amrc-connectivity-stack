/* ACS Keycloak SPI
 * Wiremock-driven tests for the F+ auth HTTP-backed user store. The
 * Wiremock stubs in this file are the spec for the endpoints Phase 3
 * adds to acs-auth.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;
import java.util.Optional;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.notFound;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FPAuthBackedUserStoreTest {

    private static final String UUID_ALICE = "00000000-0000-0000-0000-000000000001";

    /**
     * Canonical principal JSON shape returned by every Phase 3 lookup
     * endpoint. The 'name' field is the F+ principal name (corresponds to
     * Keycloak's 'username'); 'email' is optional (service principals
     * have none).
     */
    private static final String PRINCIPAL_JSON = """
        {
            "uuid": "%s",
            "name": "alice",
            "email": "alice@example.invalid"
        }
        """.formatted(UUID_ALICE);

    private WireMockServer wiremock;
    private FPAuthBackedUserStore store;

    @BeforeEach
    void setUp() {
        wiremock = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        wiremock.start();
        store = new FPAuthBackedUserStore(URI.create(wiremock.baseUrl()),
            Duration.ofSeconds(2));
    }

    @AfterEach
    void tearDown() {
        wiremock.stop();
    }

    // -- find by UUID ----------------------------------------------------

    @Test
    void find_by_uuid_parses_principal_response() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        Optional<FactoryPlusUser> user = store.findByUuid(UUID_ALICE);

        assertThat(user).isPresent();
        assertThat(user.get().uuid()).isEqualTo(UUID_ALICE);
        assertThat(user.get().username()).isEqualTo("alice");
        assertThat(user.get().email()).isEqualTo("alice@example.invalid");
    }

    @Test
    void find_by_uuid_returns_empty_on_404() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/missing"))
            .willReturn(notFound()));

        assertThat(store.findByUuid("missing")).isEmpty();
    }

    @Test
    void find_by_uuid_throws_on_5xx() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(aResponse().withStatus(503)));

        assertThatThrownBy(() -> store.findByUuid(UUID_ALICE))
            .isInstanceOf(FactoryPlusAuthException.class)
            .hasMessageContaining("503");
    }

    // -- find by username ------------------------------------------------

    @Test
    void find_by_username_uses_query_parameter() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal"))
            .withQueryParam("name", equalTo("alice"))
            .willReturn(okJson(PRINCIPAL_JSON)));

        Optional<FactoryPlusUser> user = store.findByUsername("alice");

        assertThat(user).isPresent();
        assertThat(user.get().username()).isEqualTo("alice");
        assertThat(user.get().uuid()).isEqualTo(UUID_ALICE);
    }

    @Test
    void find_by_username_returns_empty_on_404() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal"))
            .withQueryParam("name", equalTo("nope"))
            .willReturn(notFound()));

        assertThat(store.findByUsername("nope")).isEmpty();
    }

    @Test
    void find_by_username_url_encodes_special_chars() {
        // Some F+ principals have / or @ in their names. The store must
        // URL-encode the query value so it lands intact at the server.
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal"))
            .withQueryParam("name", equalTo("svc/openid"))
            .willReturn(okJson(PRINCIPAL_JSON)));

        assertThat(store.findByUsername("svc/openid")).isPresent();
    }

    // -- find by email ---------------------------------------------------

    @Test
    void find_by_email_uses_query_parameter() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal"))
            .withQueryParam("email", equalTo("alice@example.invalid"))
            .willReturn(okJson(PRINCIPAL_JSON)));

        Optional<FactoryPlusUser> user = store.findByEmail("alice@example.invalid");

        assertThat(user).isPresent();
        assertThat(user.get().email()).isEqualTo("alice@example.invalid");
    }

    @Test
    void find_by_email_returns_empty_on_404() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal"))
            .withQueryParam("email", equalTo("nope@example.invalid"))
            .willReturn(notFound()));

        assertThat(store.findByEmail("nope@example.invalid")).isEmpty();
    }

    // -- response shape edge cases ---------------------------------------

    @Test
    void principal_with_no_email_yields_dto_with_null_email() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson("""
                { "uuid": "%s", "name": "service-account" }
                """.formatted(UUID_ALICE))));

        Optional<FactoryPlusUser> user = store.findByUuid(UUID_ALICE);

        assertThat(user).isPresent();
        assertThat(user.get().email()).isNull();
    }

    @Test
    void malformed_response_throws() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson("not json at all")));

        assertThatThrownBy(() -> store.findByUuid(UUID_ALICE))
            .isInstanceOf(FactoryPlusAuthException.class);
    }
}
