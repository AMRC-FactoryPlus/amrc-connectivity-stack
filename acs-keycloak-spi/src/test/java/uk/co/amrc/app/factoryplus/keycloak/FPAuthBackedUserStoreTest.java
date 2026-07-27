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
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.put;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
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

    // -- short-name / default realm normalisation -----------------------

    @Test
    void short_name_gets_default_realm_appended() {
        // User types "alice" on the login form. With a default realm
        // configured, the SPI must look up "alice@FACTORYPLUS.LOCAL"
        // rather than the bare short name (which F+ would 410 on).
        var withRealm = new FPAuthBackedUserStore(
            URI.create(wiremock.baseUrl()), Duration.ofSeconds(2),
            null, "FACTORYPLUS.LOCAL");
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/alice%40FACTORYPLUS.LOCAL"))
            .willReturn(okJson("\"" + UUID_ALICE + "\"")));
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        assertThat(withRealm.findByUsername("alice")).isPresent();
    }

    @Test
    void short_name_default_realm_is_used_verbatim() {
        // Use the configured default realm exactly as supplied. While
        // uppercase Kerberos realms are convention, not every
        // deployment follows it - some clusters run mixed- or
        // lowercase realms, and case-folding the configured value
        // would silently break their lookups.
        var withRealm = new FPAuthBackedUserStore(
            URI.create(wiremock.baseUrl()), Duration.ofSeconds(2),
            null, "factoryplus.local");
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/alice%40factoryplus.local"))
            .willReturn(okJson("\"" + UUID_ALICE + "\"")));
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        assertThat(withRealm.findByUsername("alice")).isPresent();
    }

    @Test
    void typed_upn_realm_passes_through_verbatim() {
        // A previous canonicaliseUpn() always uppercased the realm
        // part of any @-suffixed input. Drop that: respect whatever
        // the user typed (or whatever Keycloak forwarded). Mixed-
        // and lowercase realms exist; force-casing them breaks F+
        // identity lookups against entries that don't match the
        // forced casing.
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/alice%40mixed.Realm"))
            .willReturn(okJson("\"" + UUID_ALICE + "\"")));
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        assertThat(store.findByUsername("alice@mixed.Realm")).isPresent();
    }

    @Test
    void cross_realm_upn_passes_through_unchanged_when_default_realm_set() {
        // User from a federated realm types their full UPN; the local
        // default realm must not override it. The lookup must hit the
        // OTHER realm's identity endpoint with the original suffix
        // preserved.
        var withRealm = new FPAuthBackedUserStore(
            URI.create(wiremock.baseUrl()), Duration.ofSeconds(2),
            null, "FACTORYPLUS.LOCAL");
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/bob%40OTHER.REALM"))
            .willReturn(okJson("\"" + UUID_ALICE + "\"")));
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        assertThat(withRealm.findByUsername("bob@OTHER.REALM")).isPresent();
    }

    @Test
    void short_name_passes_through_when_no_default_realm_configured() {
        // The legacy constructor leaves defaultRealm null. Short names
        // must be passed through verbatim (and F+ will 410) so the
        // behaviour is unchanged from before this feature.
        wiremock.stubFor(get(urlPathEqualTo("/v2/identity/kerberos/alice"))
            .willReturn(aResponse().withStatus(410)));

        assertThat(store.findByUsername("alice")).isEmpty();
    }

    @Test
    void short_name_passes_through_when_default_realm_is_blank() {
        // Empty/blank config values are common in Keycloak (the field
        // exists but the admin hasn't filled it in). Treat blank the
        // same as absent: no realm-appending, F+ sees the bare name.
        var blankRealm = new FPAuthBackedUserStore(
            URI.create(wiremock.baseUrl()), Duration.ofSeconds(2),
            null, "   ");
        wiremock.stubFor(get(urlPathEqualTo("/v2/identity/kerberos/alice"))
            .willReturn(aResponse().withStatus(410)));

        assertThat(blankRealm.findByUsername("alice")).isEmpty();
    }

    // -- realm-case retry ------------------------------------------------

    @Test
    void first_candidate_hit_does_not_trigger_the_realm_case_retry() {
        // The verbatim form is authoritative. If it resolves we must
        // not spend a second round trip on the upper-cased realm -
        // both timeouts come out of Keycloak's 3-second budget.
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/alice%40mixed.Realm"))
            .willReturn(okJson("\"" + UUID_ALICE + "\"")));
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        assertThat(store.findByUsername("alice@mixed.Realm")).isPresent();

        assertThat(wiremock.getAllServeEvents())
            .as("Identity lookup + principal lookup, and nothing else")
            .hasSize(2);
    }

    @Test
    void miss_on_verbatim_realm_retries_with_the_realm_upper_cased() {
        // Keycloak lower-cases the whole username before it reaches
        // us, so a fully qualified login arrives as
        // alice@factoryplus.local. F+ compares identity names with
        // exact string equality, so the verbatim lookup 410s and only
        // the upper-cased realm matches.
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/alice%40factoryplus.local"))
            .willReturn(aResponse().withStatus(410)));
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/alice%40FACTORYPLUS.LOCAL"))
            .willReturn(okJson("\"" + UUID_ALICE + "\"")));
        wiremock.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_ALICE))
            .willReturn(okJson(PRINCIPAL_JSON)));

        Optional<FactoryPlusUser> user = store.findByUsername("alice@factoryplus.local");

        assertThat(user).isPresent();
        assertThat(user.get().username()).isEqualTo(UPN_ALICE);
        assertThat(user.get().provisional())
            .as("A local principal is not provisional")
            .isFalse();
    }

    @Test
    void only_the_realm_portion_is_upper_cased_on_retry() {
        // Documented limitation: Keycloak has already folded the user
        // portion's case and the original is unrecoverable, so we
        // never touch it. An F+ identity stored as "Alice@..." stays
        // unreachable.
        assertThat(FPAuthBackedUserStore.candidateUpns("alice@mixed.Realm"))
            .containsExactly("alice@mixed.Realm", "alice@MIXED.REALM");
    }

    @Test
    void no_retry_candidate_when_the_realm_is_already_upper_case() {
        assertThat(FPAuthBackedUserStore.candidateUpns(UPN_ALICE))
            .containsExactly(UPN_ALICE);
    }

    @Test
    void short_name_with_no_realm_has_a_single_candidate() {
        assertThat(FPAuthBackedUserStore.candidateUpns("alice"))
            .containsExactly("alice");
    }

    // -- cross-realm resolution ------------------------------------------

    private static final String UUID_BOB = "00000000-0000-0000-0000-0000000000b0";
    private static final String UPN_BOB  = "bob@OTHER.REALM";

    /** Both casing candidates for bob@other.realm 410 locally. */
    private void stubLocalMissForBob() {
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/bob%40other.realm"))
            .willReturn(aResponse().withStatus(410)));
        wiremock.stubFor(get(urlPathEqualTo(
                "/v2/identity/kerberos/bob%40OTHER.REALM"))
            .willReturn(aResponse().withStatus(410)));
    }

    /** Local store trusting OTHER.REALM, optionally with a home auth
     *  URL. The "home cluster" is a second Wiremock instance. */
    private FPAuthBackedUserStore trustingStore(URI homeUrl) {
        return new FPAuthBackedUserStore(
            URI.create(wiremock.baseUrl()), Duration.ofSeconds(2), null, null,
            Set.of("OTHER.REALM"),
            homeUrl == null ? Map.of() : Map.of("other.realm", homeUrl),
            Duration.ofMillis(1500));
    }

    @Test
    void untrusted_realm_returns_empty_after_both_candidates_miss() {
        // Existing behaviour must be unchanged for anything the admin
        // hasn't explicitly trusted.
        stubLocalMissForBob();

        assertThat(store.findByUsername("bob@other.realm")).isEmpty();
    }

    @Test
    void trusted_realm_with_auth_url_resolves_the_home_uuid() {
        var home = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        home.start();
        try {
            stubLocalMissForBob();
            home.stubFor(get(urlPathEqualTo(
                    "/v2/identity/kerberos/bob%40OTHER.REALM"))
                .willReturn(okJson("\"" + UUID_BOB + "\"")));
            home.stubFor(get(urlPathEqualTo("/v2/principal/" + UUID_BOB))
                .willReturn(okJson("""
                    { "uuid": "%s", "kerberos": "%s" }
                    """.formatted(UUID_BOB, UPN_BOB))));

            Optional<FactoryPlusUser> user = trustingStore(URI.create(home.baseUrl()))
                .findByUsername("bob@other.realm");

            assertThat(user).isPresent();
            assertThat(user.get().uuid())
                .as("The user keeps their home cluster's principal UUID")
                .isEqualTo(UUID_BOB);
            assertThat(user.get().username())
                .as("Home cluster's own spelling of the UPN wins")
                .isEqualTo(UPN_BOB);
            assertThat(user.get().provisional())
                .as("Nothing has been written locally yet")
                .isTrue();
            assertThat(user.get().uuid())
                .as("The remote-resolve path adopts the home UUID; it must "
                    + "NOT derive one, or the two clusters would disagree "
                    + "about who this user is")
                .isNotEqualTo(FPAuthBackedUserStore.mintedUuid(UPN_BOB));
        }
        finally {
            home.stop();
        }
    }

    @Test
    void trusted_realm_with_no_auth_url_mints_a_provisional_user() {
        stubLocalMissForBob();

        Optional<FactoryPlusUser> user = trustingStore(null)
            .findByUsername("bob@other.realm");

        assertThat(user).isPresent();
        assertThat(user.get().provisional()).isTrue();
        assertThat(user.get().username()).isEqualTo(UPN_BOB);
        // Keycloak derives the federated storage id from the UUID and
        // re-reads the user by that id later in the same login flow,
        // so a null would break the flow after admit had already
        // written. We derive at lookup time instead; nothing is
        // persisted until the KDC confirms the password.
        assertThat(user.get().uuid())
            .as("A provisional user still needs a usable storage id")
            .isEqualTo(FPAuthBackedUserStore.mintedUuid(UPN_BOB));
    }

    // -- minted UUID derivation ------------------------------------------

    @Test
    void minted_uuid_matches_a_fixed_known_vector() {
        // Pinned against the RFC 4122 reference implementation:
        //   python3 -c "import uuid; print(uuid.uuid5(
        //       uuid.UUID('cb3714c4-c85c-482a-987b-408293aa141e'),
        //       'me1ago@AMRC-FP.SHEF.AC.UK'))"
        // If a refactor changes this value it has silently orphaned
        // every principal ever minted on the cross-realm path, so this
        // assertion must never be "updated to match" - fix the code.
        assertThat(FPAuthBackedUserStore.mintedUuid("me1ago@AMRC-FP.SHEF.AC.UK"))
            .isEqualTo("12bb7b35-16c8-572d-af5f-c1f312ec4ae8");
        assertThat(FPAuthBackedUserStore.mintedUuid(UPN_BOB))
            .isEqualTo("5bd38a45-a07c-5606-b10a-b997b05f275b");
    }

    @Test
    void the_namespace_constant_is_fixed() {
        // Changing this orphans every minted principal. Pinned so the
        // consequence has to be confronted deliberately.
        assertThat(FPAuthBackedUserStore.ACS_PRINCIPAL_NAMESPACE)
            .hasToString("cb3714c4-c85c-482a-987b-408293aa141e");
    }

    @Test
    void minted_uuid_has_version_5_and_the_rfc_4122_variant() {
        // Not UUID.nameUUIDFromBytes, which is MD5 and stamps version 3.
        var uuid = java.util.UUID.fromString(FPAuthBackedUserStore.mintedUuid(UPN_BOB));
        assertThat(uuid.version()).isEqualTo(5);
        assertThat(uuid.variant())
            .as("RFC 4122 variant, i.e. the two top bits of octet 8 are 10")
            .isEqualTo(2);
    }

    @Test
    void minted_uuid_is_identical_across_separate_store_instances() {
        // The whole point: two clusters, no coordination, same answer.
        var clusterA = trustingStore(null);
        var clusterB = new FPAuthBackedUserStore(
            URI.create("http://elsewhere.invalid"), Duration.ofSeconds(2),
            null, "SOME.OTHER.DEFAULT",
            Set.of("OTHER.REALM"), Map.of(), Duration.ofMillis(900));
        stubLocalMissForBob();

        String a = clusterA.findByUsername("bob@other.realm").orElseThrow().uuid();
        String b = FPAuthBackedUserStore.mintedUuid(UPN_BOB);

        assertThat(a).isEqualTo(b);
        assertThat(clusterB).isNotNull();
    }

    @Test
    void minted_uuid_is_stable_across_repeated_lookups() {
        stubLocalMissForBob();
        var trusting = trustingStore(null);

        assertThat(trusting.findByUsername("bob@other.realm").orElseThrow().uuid())
            .isEqualTo(trusting.findByUsername("bob@other.realm").orElseThrow().uuid());
    }

    @Test
    void different_upns_derive_different_uuids() {
        assertThat(FPAuthBackedUserStore.mintedUuid("alice@OTHER.REALM"))
            .isNotEqualTo(FPAuthBackedUserStore.mintedUuid(UPN_BOB));
    }

    @Test
    void minting_derives_from_the_canonicalised_upn_not_what_keycloak_typed() {
        // Keycloak hands us bob@other.realm; the identity we write, and
        // therefore the name we derive from, is bob@OTHER.REALM. An
        // operator computing the UUID by hand uses the canonical form.
        stubLocalMissForBob();

        var user = trustingStore(null).findByUsername("bob@other.realm").orElseThrow();

        assertThat(user.username()).isEqualTo(UPN_BOB);
        assertThat(user.uuid()).isEqualTo(FPAuthBackedUserStore.mintedUuid(UPN_BOB));
        assertThat(user.uuid())
            .as("Deriving from the lower-cased form would break cross-cluster agreement")
            .isNotEqualTo(FPAuthBackedUserStore.mintedUuid("bob@other.realm"));
    }

    @Test
    void admit_with_no_uuid_derives_rather_than_randomising() {
        wiremock.stubFor(put(urlPathMatching("/v2/principal/[^/]+/kerberos"))
            .willReturn(aResponse().withStatus(204)));

        assertThat(store.admit(UPN_BOB, null))
            .isEqualTo(FPAuthBackedUserStore.mintedUuid(UPN_BOB));
    }

    @Test
    void trusted_realm_home_410_returns_empty() {
        var home = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        home.start();
        try {
            stubLocalMissForBob();
            home.stubFor(get(urlPathEqualTo(
                    "/v2/identity/kerberos/bob%40OTHER.REALM"))
                .willReturn(aResponse().withStatus(410)));

            assertThat(trustingStore(URI.create(home.baseUrl()))
                .findByUsername("bob@other.realm"))
                .as("The user genuinely doesn't exist at home either")
                .isEmpty();
        }
        finally {
            home.stop();
        }
    }

    @Test
    void trusted_realm_home_5xx_throws_rather_than_returning_empty() {
        // This distinction is the point. Empty means "no such user"
        // and Keycloak reports user_not_found; the exception means
        // "infrastructure failed" and Keycloak fails the login. A home
        // cluster being down must never read as the user not existing.
        var home = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        home.start();
        try {
            stubLocalMissForBob();
            home.stubFor(get(urlPathEqualTo(
                    "/v2/identity/kerberos/bob%40OTHER.REALM"))
                .willReturn(aResponse().withStatus(503)));

            var trusting = trustingStore(URI.create(home.baseUrl()));
            assertThatThrownBy(() -> trusting.findByUsername("bob@other.realm"))
                .isInstanceOf(FactoryPlusAuthException.class)
                .hasMessageContaining("503");
        }
        finally {
            home.stop();
        }
    }

    @Test
    void trusted_realm_home_timeout_throws_rather_than_returning_empty() {
        var home = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        home.start();
        try {
            stubLocalMissForBob();
            home.stubFor(get(urlPathEqualTo(
                    "/v2/identity/kerberos/bob%40OTHER.REALM"))
                .willReturn(okJson("\"" + UUID_BOB + "\"").withFixedDelay(3000)));

            var trusting = new FPAuthBackedUserStore(
                URI.create(wiremock.baseUrl()), Duration.ofSeconds(2), null, null,
                Set.of("OTHER.REALM"),
                Map.of("OTHER.REALM", URI.create(home.baseUrl())),
                Duration.ofMillis(300));

            assertThatThrownBy(() -> trusting.findByUsername("bob@other.realm"))
                .isInstanceOf(FactoryPlusAuthException.class);
        }
        finally {
            home.stop();
        }
    }

    @Test
    void trusted_realm_home_403_fails_the_login_and_never_mints() {
        // 403 means the home cluster has not granted us ReadKrb.
        // Falling back to minting a fresh local UUID would defeat
        // revocation - the ReadKrb grant is the kill switch for the
        // whole trust relationship - and would split the estate into
        // home-derived and locally-minted principals depending on when
        // each user first logged in. Keep it fatal.
        var home = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        home.start();
        try {
            stubLocalMissForBob();
            home.stubFor(get(urlPathMatching("/v2/identity/kerberos/.*"))
                .willReturn(aResponse().withStatus(403)));

            var trusting = trustingStore(URI.create(home.baseUrl()));
            assertThatThrownBy(() -> trusting.findByUsername("bob@other.realm"))
                .isInstanceOf(FactoryPlusAccessDeniedException.class)
                .as("The message must lead an operator to the fix, which "
                    + "lives on a different cluster from the error")
                .hasMessageContaining("ReadKrb")
                .hasMessageContaining("e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c")
                .hasMessageContaining("OTHER.REALM")
                .hasMessageContaining(home.baseUrl());
        }
        finally {
            home.stop();
        }
    }

    @Test
    void trusted_realm_home_403_names_the_denied_principal() {
        var home = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        home.start();
        try {
            stubLocalMissForBob();
            home.stubFor(get(urlPathMatching("/v2/identity/kerberos/.*"))
                .willReturn(aResponse().withStatus(403)));

            var trusting = new FPAuthBackedUserStore(
                URI.create(wiremock.baseUrl()), Duration.ofSeconds(2),
                new StubAuthenticator("T", "sv1openid@LOCAL.REALM"), null,
                Set.of("OTHER.REALM"),
                Map.of("OTHER.REALM", URI.create(home.baseUrl())),
                Duration.ofMillis(1500));

            assertThatThrownBy(() -> trusting.findByUsername("bob@other.realm"))
                .hasMessageContaining("sv1openid@LOCAL.REALM");
        }
        finally {
            home.stop();
        }
    }

    @Test
    void a_standing_403_is_cached_so_it_costs_one_call_not_one_per_attempt() {
        // Lookup runs BEFORE password validation, so while
        // misconfigured anyone reaching the login page could bounce a
        // call off the remote cluster per attempt just by typing
        // foreign usernames. 5xx and timeouts stay uncached (they're
        // transient); a 403 is a standing configuration state.
        var home = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        home.start();
        try {
            stubLocalMissForBob();
            home.stubFor(get(urlPathMatching("/v2/identity/kerberos/.*"))
                .willReturn(aResponse().withStatus(403)));

            var trusting = trustingStore(URI.create(home.baseUrl()));
            assertThatThrownBy(() -> trusting.findByUsername("bob@other.realm"))
                .isInstanceOf(FactoryPlusAccessDeniedException.class);
            int afterFirst = home.getAllServeEvents().size();
            assertThat(afterFirst).isGreaterThan(0);

            // A different user in the same realm, so no per-user cache
            // could explain the suppression.
            wiremock.stubFor(get(urlPathMatching("/v2/identity/kerberos/carol.*"))
                .willReturn(aResponse().withStatus(410)));
            assertThatThrownBy(() -> trusting.findByUsername("carol@other.realm"))
                .as("Still fatal - suppressing the call must not soften the failure")
                .isInstanceOf(FactoryPlusAccessDeniedException.class)
                .hasMessageContaining("ReadKrb");

            assertThat(home.getAllServeEvents())
                .as("The denial is keyed by realm, so the second attempt "
                    + "must not touch the home cluster at all")
                .hasSize(afterFirst);
        }
        finally {
            home.stop();
        }
    }

    @Test
    void a_home_5xx_is_not_cached() {
        // Contrast with the 403 above: a transient failure must not
        // lock out lookups, so every attempt re-tries the home cluster.
        var home = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        home.start();
        try {
            stubLocalMissForBob();
            home.stubFor(get(urlPathMatching("/v2/identity/kerberos/.*"))
                .willReturn(aResponse().withStatus(503)));

            var trusting = trustingStore(URI.create(home.baseUrl()));
            assertThatThrownBy(() -> trusting.findByUsername("bob@other.realm"))
                .isInstanceOf(FactoryPlusAuthException.class);
            int afterFirst = home.getAllServeEvents().size();

            assertThatThrownBy(() -> trusting.findByUsername("bob@other.realm"))
                .isInstanceOf(FactoryPlusAuthException.class);

            assertThat(home.getAllServeEvents().size())
                .as("5xx must stay uncached so recovery is immediate")
                .isGreaterThan(afterFirst);
        }
        finally {
            home.stop();
        }
    }

    @Test
    void trusted_realm_matching_is_case_insensitive() {
        // The incoming realm is lower-cased by Keycloak and the
        // configured list may be typed either way, so neither side can
        // be assumed canonical.
        stubLocalMissForBob();
        var trusting = new FPAuthBackedUserStore(
            URI.create(wiremock.baseUrl()), Duration.ofSeconds(2), null, null,
            Set.of("other.realm"), Map.of(), Duration.ofMillis(1500));

        assertThat(trusting.findByUsername("bob@other.realm")).isPresent();
    }

    // -- admit -----------------------------------------------------------

    @Test
    void admit_puts_the_upn_as_a_json_string_against_the_given_uuid() {
        wiremock.stubFor(put(urlPathEqualTo(
                "/v2/principal/" + UUID_BOB + "/kerberos"))
            .willReturn(aResponse().withStatus(204)));

        assertThat(store.admit(UPN_BOB, UUID_BOB)).isEqualTo(UUID_BOB);

        var event = wiremock.getAllServeEvents().get(0);
        assertThat(event.getRequest().getBodyAsString())
            .as("acs-auth parses bodies with express.json, so the UPN "
                + "goes over the wire as a JSON string literal")
            .isEqualTo("\"" + UPN_BOB + "\"");
        assertThat(event.getRequest().getHeader("Content-Type"))
            .isEqualTo("application/json");
    }

    @Test
    void admit_mints_a_uuid_when_given_none() {
        wiremock.stubFor(put(urlPathMatching("/v2/principal/[^/]+/kerberos"))
            .willReturn(aResponse().withStatus(204)));

        String uuid = store.admit(UPN_BOB, null);

        assertThat(uuid).isNotNull();
        assertThat(wiremock.getAllServeEvents().get(0).getRequest().getUrl())
            .contains(uuid);
    }

    @Test
    void admit_throws_when_the_write_is_refused() {
        // 403 means sv1openid lacks WriteKrb on the target. The login
        // must fail rather than issue a token whose principal doesn't
        // exist.
        wiremock.stubFor(put(urlPathEqualTo(
                "/v2/principal/" + UUID_BOB + "/kerberos"))
            .willReturn(aResponse().withStatus(403)));

        assertThatThrownBy(() -> store.admit(UPN_BOB, UUID_BOB))
            .isInstanceOf(FactoryPlusAuthException.class)
            .hasMessageContaining("403");
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

    // -- find permissions -----------------------------------------------

    private static final String WILDCARD = "00000000-0000-0000-0000-000000000000";

    @Test
    void find_permissions_returns_wildcard_targeted_perms() {
        // Body shape mirrors acs-auth's GET /v2/acl/<uuid>: list of
        // {permission, target} (with optional plural). Targeted entries
        // are filtered out - only Wildcard counts as a "role" for OIDC.
        wiremock.stubFor(get(urlPathEqualTo("/v2/acl/" + UUID_ALICE))
            .willReturn(okJson("""
                [
                  {"permission":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                   "target":"00000000-0000-0000-0000-000000000000"},
                  {"permission":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                   "target":"00000000-0000-0000-0000-000000000000"},
                  {"permission":"cccccccc-cccc-cccc-cccc-cccccccccccc",
                   "target":"deadbeef-0000-0000-0000-000000000000"}
                ]
                """)));

        var perms = store.findPermissionsForPrincipal(UUID_ALICE);

        assertThat(perms).containsExactlyInAnyOrder(
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    }

    @Test
    void find_permissions_returns_empty_when_principal_not_found() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/acl/missing"))
            .willReturn(aResponse().withStatus(410)));

        assertThat(store.findPermissionsForPrincipal("missing")).isEmpty();
    }

    @Test
    void find_permissions_returns_empty_for_principal_with_no_grants() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/acl/" + UUID_ALICE))
            .willReturn(okJson("[]")));

        assertThat(store.findPermissionsForPrincipal(UUID_ALICE)).isEmpty();
    }

    @Test
    void find_permissions_throws_on_5xx() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/acl/" + UUID_ALICE))
            .willReturn(aResponse().withStatus(503)));

        assertThatThrownBy(() -> store.findPermissionsForPrincipal(UUID_ALICE))
            .isInstanceOf(FactoryPlusAuthException.class)
            .hasMessageContaining("503");
    }

    @Test
    void find_permissions_throws_on_malformed_response() {
        wiremock.stubFor(get(urlPathEqualTo("/v2/acl/" + UUID_ALICE))
            .willReturn(okJson("{\"unexpected\": \"object\"}")));

        assertThatThrownBy(() -> store.findPermissionsForPrincipal(UUID_ALICE))
            .isInstanceOf(FactoryPlusAuthException.class);
    }

    /** Captures call count + last target URL for assertion. */
    private static final class StubAuthenticator implements KerberosAuthenticator {
        final String token;
        final String principal;
        int callCount;
        URI lastTarget;

        StubAuthenticator(String token) { this(token, null); }

        StubAuthenticator(String token, String principal) {
            this.token = token;
            this.principal = principal;
        }

        @Override
        public String principalName() { return principal; }

        @Override
        public String spnegoTokenFor(URI target) {
            callCount++;
            lastTarget = target;
            return token;
        }
    }
}
