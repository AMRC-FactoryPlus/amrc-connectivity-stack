/* ACS Keycloak SPI
 * Wiremock-driven tests for the F+ auth HTTP-backed user store. Stubs
 * mirror the actual existing acs-auth v2 identity endpoints (Phase 3).
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
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FPAuthBackedUserStoreTest {

    private static final String UUID_ALICE = "00000000-0000-0000-0000-000000000001";
    private static final String UPN_ALICE  = "alice@FACTORYPLUS.LOCAL";

    /** Canonical principal response shape: identity kinds become object
     *  keys. Today only the 'kerberos' key exists in F+. */
    private static final String PRINCIPAL_JSON = """
        { "uuid": "%s", "kerberos": "%s" }
        """.formatted(UUID_ALICE, UPN_ALICE);

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
        assertThat(user.get().username())
            .as("Username is the full Kerberos UPN, matching Keycloak's "
                + "Kerberos federation convention")
            .isEqualTo(UPN_ALICE);
        assertThat(user.get().email())
            .as("F+ has no email field; always null in v1")
            .isNull();
    }

    @Test
    void find_by_uuid_returns_empty_on_410() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/missing"))
            .willReturn(aResponse().withStatus(410)));

        assertThat(store.findByUuid("missing")).isEmpty();
    }

    @Test
    void find_by_uuid_also_returns_empty_on_404() {
        // F+ uses 410, but accept 404 too in case a proxy rewrites it.
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/missing"))
            .willReturn(aResponse().withStatus(404)));

        assertThat(store.findByUuid("missing")).isEmpty();
    }

    @Test
    void find_by_uuid_returns_empty_when_principal_has_no_kerberos_identity() {
        // Principal exists but has no kerberos identity yet (e.g. a
        // service principal added via UUID without registering its
        // Kerberos UPN). Treat as not-resolvable rather than failing.
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson("""
                { "uuid": "%s" }
                """.formatted(UUID_ALICE))));

        assertThat(store.findByUuid(UUID_ALICE)).isEmpty();
    }

    @Test
    void find_by_uuid_throws_on_5xx() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(aResponse().withStatus(503)));

        assertThatThrownBy(() -> store.findByUuid(UUID_ALICE))
            .isInstanceOf(FactoryPlusAuthException.class)
            .hasMessageContaining("503");
    }

    @Test
    void find_by_uuid_throws_on_malformed_response() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson("not json at all")));

        assertThatThrownBy(() -> store.findByUuid(UUID_ALICE))
            .isInstanceOf(FactoryPlusAuthException.class);
    }

    // -- find by username (two-call path) --------------------------------

    @Test
    void find_by_username_resolves_identity_then_principal() {
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/" + UPN_ALICE.replace("@", "%40")))
            .willReturn(okJson("\"" + UUID_ALICE + "\"")));
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        Optional<FactoryPlusUser> user = store.findByUsername(UPN_ALICE);

        assertThat(user).isPresent();
        assertThat(user.get().username()).isEqualTo(UPN_ALICE);
        assertThat(user.get().uuid()).isEqualTo(UUID_ALICE);
    }

    @Test
    void find_by_username_returns_empty_when_identity_missing() {
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/" + "nope%40FACTORYPLUS.LOCAL"))
            .willReturn(aResponse().withStatus(410)));

        assertThat(store.findByUsername("nope@FACTORYPLUS.LOCAL")).isEmpty();
    }

    @Test
    void find_by_username_returns_empty_when_principal_disappears_between_calls() {
        // Identity lookup succeeds (so the principal exists per the
        // identity table) but the principal lookup races with a delete.
        // We treat the second 410 as not-found rather than as a fault.
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/" + UPN_ALICE.replace("@", "%40")))
            .willReturn(okJson("\"" + UUID_ALICE + "\"")));
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(aResponse().withStatus(410)));

        assertThat(store.findByUsername(UPN_ALICE)).isEmpty();
    }

    @Test
    void find_by_username_throws_when_identity_endpoint_returns_non_string() {
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/" + UPN_ALICE.replace("@", "%40")))
            .willReturn(okJson("{\"unexpected\": \"object\"}")));

        assertThatThrownBy(() -> store.findByUsername(UPN_ALICE))
            .isInstanceOf(FactoryPlusAuthException.class)
            .hasMessageContaining("UUID string");
    }

    @Test
    void find_by_username_url_encodes_special_chars_in_upn() {
        // F+ service principals often have a slash in the UPN
        // (HTTP/openid.acs.example@REALM).
        String upn = "HTTP/openid@FACTORYPLUS.LOCAL";
        // URLEncoder turns / into %2F and @ into %40.
        String encoded = "HTTP%2Fopenid%40FACTORYPLUS.LOCAL";
        wiremock.stubFor(get(urlPathEqualTo("/v2/identity/kerberos/" + encoded))
            .willReturn(okJson("\"" + UUID_ALICE + "\"")));
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        assertThat(store.findByUsername(upn)).isPresent();
    }

    // -- find by email ---------------------------------------------------

    @Test
    void find_by_email_always_returns_empty_makes_no_http_call() {
        // F+ has no email field. We assert NO HTTP request is made -
        // bypassing the wiremock entirely.
        Optional<FactoryPlusUser> result = store.findByEmail("anything@example.invalid");

        assertThat(result).isEmpty();
        assertThat(wiremock.getAllServeEvents())
            .as("findByEmail must not hit F+; it has no email field")
            .isEmpty();
    }

    // -- SPNEGO authentication injection (Phase 6) -----------------------

    @Test
    void requests_have_no_authorization_header_when_authenticator_is_null() {
        // Phase 2 mode: no Kerberos auth. Useful for tests against
        // unauthenticated F+ stand-ins like Wiremock.
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        store.findByUuid(UUID_ALICE);

        assertThat(wiremock.getAllServeEvents()).hasSize(1);
        var serveEvent = wiremock.getAllServeEvents().get(0);
        assertThat(serveEvent.getRequest().getHeader("Authorization"))
            .as("No Kerberos authenticator -> no Authorization header")
            .isNull();
    }

    @Test
    void requests_carry_negotiate_header_when_authenticator_present() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        var stubAuth = new StubAuthenticator("STUB-SPNEGO-TOKEN");
        var authedStore = new FPAuthBackedUserStore(
            URI.create(wiremock.baseUrl()), Duration.ofSeconds(2), stubAuth);

        authedStore.findByUuid(UUID_ALICE);

        assertThat(stubAuth.callCount)
            .as("Authenticator should be consulted for the call")
            .isEqualTo(1);
        var serveEvent = wiremock.getAllServeEvents().get(0);
        assertThat(serveEvent.getRequest().getHeader("Authorization"))
            .isEqualTo("Negotiate STUB-SPNEGO-TOKEN");
    }

    @Test
    void authenticator_called_with_target_url() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        var stubAuth = new StubAuthenticator("T");
        var authedStore = new FPAuthBackedUserStore(
            URI.create(wiremock.baseUrl()), Duration.ofSeconds(2), stubAuth);

        authedStore.findByUuid(UUID_ALICE);

        assertThat(stubAuth.lastTarget).isNotNull();
        assertThat(stubAuth.lastTarget.getHost())
            .as("Authenticator must be told the host so it can build the SPN")
            .isEqualTo("localhost");
    }

    /** Captures call count + last target URL for assertion. */
    private static final class StubAuthenticator implements KerberosAuthenticator {
        final String token;
        int callCount;
        URI lastTarget;

        StubAuthenticator(String token) { this.token = token; }

        @Override
        public String spnegoTokenFor(URI target) {
            callCount++;
            lastTarget = target;
            return token;
        }
    }
}
