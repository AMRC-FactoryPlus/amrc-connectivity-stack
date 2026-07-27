/* ACS Keycloak SPI
 * TTL cache wrapper for FactoryPlusUserStore. Decorates a delegate
 * store; caches both hits and misses for the configured TTL so that
 * a stream of identical lookups (e.g. someone hammering the login
 * endpoint) doesn't pummel F+.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class CachingFactoryPlusUserStoreTest {

    private static final FactoryPlusUser ALICE = new FactoryPlusUser(
        "alice-uuid", "alice@FACTORYPLUS.LOCAL", null);
    private static final Duration TTL = Duration.ofSeconds(60);

    private CountingStore counting;
    private MutableClock clock;
    private CachingFactoryPlusUserStore cache;

    @BeforeEach
    void setUp() {
        counting = new CountingStore();
        clock = new MutableClock(Instant.parse("2026-05-07T12:00:00Z"));
        cache = new CachingFactoryPlusUserStore(counting, TTL, clock);
    }

    @Test
    void first_uuid_lookup_calls_delegate() {
        counting.respondWith(Optional.of(ALICE));

        assertThat(cache.findByUuid("alice-uuid")).contains(ALICE);
        assertThat(counting.uuidCalls).isEqualTo(1);
    }

    @Test
    void second_uuid_lookup_within_ttl_hits_cache() {
        counting.respondWith(Optional.of(ALICE));

        cache.findByUuid("alice-uuid");
        cache.findByUuid("alice-uuid");

        assertThat(counting.uuidCalls)
            .as("Cache hit; delegate should be called only once")
            .isEqualTo(1);
    }

    @Test
    void uuid_lookup_after_ttl_expiry_refetches() {
        counting.respondWith(Optional.of(ALICE));

        cache.findByUuid("alice-uuid");
        clock.advance(Duration.ofSeconds(61));
        cache.findByUuid("alice-uuid");

        assertThat(counting.uuidCalls).isEqualTo(2);
    }

    @Test
    void miss_is_also_cached() {
        // When F+ says "no such user", we shouldn't keep asking. Cache
        // misses too. (Otherwise: brute-force username probing trivially
        // hammers F+ via Keycloak's federation chain.)
        counting.respondWith(Optional.empty());

        cache.findByUuid("missing-uuid");
        cache.findByUuid("missing-uuid");

        assertThat(counting.uuidCalls).isEqualTo(1);
    }

    @Test
    void cache_keyspaces_are_separate_per_lookup_kind() {
        counting.respondWith(Optional.of(ALICE));

        cache.findByUuid("alice-uuid");
        cache.findByUsername("alice-uuid");

        assertThat(counting.uuidCalls).isEqualTo(1);
        assertThat(counting.usernameCalls)
            .as("findByUsername with the same string should NOT hit the uuid cache")
            .isEqualTo(1);
    }

    @Test
    void group_lookups_are_cached_too() {
        counting.respondWithGroups(Set.of("g1", "g2"));

        cache.findPermissionsForPrincipal("alice-uuid");
        cache.findPermissionsForPrincipal("alice-uuid");

        assertThat(counting.groupCalls)
            .as("Second group lookup within TTL should hit cache")
            .isEqualTo(1);
    }

    @Test
    void group_cache_is_separate_from_user_caches() {
        counting.respondWith(Optional.of(ALICE));
        counting.respondWithGroups(Set.of("g1"));

        cache.findByUuid("alice-uuid");
        cache.findPermissionsForPrincipal("alice-uuid");

        assertThat(counting.uuidCalls).isEqualTo(1);
        assertThat(counting.groupCalls)
            .as("Same key in user-cache must not satisfy group cache")
            .isEqualTo(1);
    }

    @Test
    void username_and_email_caches_behave_like_uuid() {
        counting.respondWith(Optional.of(ALICE));

        cache.findByUsername("alice@FACTORYPLUS.LOCAL");
        cache.findByUsername("alice@FACTORYPLUS.LOCAL");
        cache.findByEmail("never@example.invalid");
        cache.findByEmail("never@example.invalid");

        assertThat(counting.usernameCalls).isEqualTo(1);
        assertThat(counting.emailCalls).isEqualTo(1);
    }

    @Test
    void exception_from_delegate_propagates_and_does_not_pollute_cache() {
        // First call: delegate throws. Cache must NOT remember the
        // exception as a "result" - that would block recovery for the
        // full TTL after a transient F+ blip.
        counting.respondWithException();
        try {
            cache.findByUuid("alice-uuid");
        }
        catch (FactoryPlusAuthException expected) { /* ok */ }

        // Second call: delegate now succeeds. Cache should re-call.
        counting.respondWith(Optional.of(ALICE));
        assertThat(cache.findByUuid("alice-uuid")).contains(ALICE);
        assertThat(counting.uuidCalls)
            .as("First (failed) call + second (succeeded) call = 2 delegate hits")
            .isEqualTo(2);
    }

    // -- admit / cross-realm admission -----------------------------------

    @Test
    void admit_invalidates_the_cached_miss_for_that_username() {
        // A cross-realm user is looked up (miss, negatively cached),
        // then admitted after their password validates. Without
        // invalidation the negative entry masks the principal we just
        // created for the full 60s TTL and the very next lookup in the
        // login flow fails.
        counting.respondWith(Optional.empty());
        assertThat(cache.findByUsername("bob@OTHER.REALM")).isEmpty();
        assertThat(counting.usernameCalls).isEqualTo(1);

        cache.admit("bob@OTHER.REALM", "bob-uuid");

        counting.respondWith(Optional.of(
            new FactoryPlusUser("bob-uuid", "bob@OTHER.REALM", null)));
        assertThat(cache.findByUsername("bob@OTHER.REALM"))
            .as("Cache must re-ask the delegate after admit")
            .isPresent();
        assertThat(counting.usernameCalls).isEqualTo(2);
    }

    @Test
    void admit_invalidates_a_cached_provisional_user_under_any_key() {
        // Keycloak lower-cases the username, so the cache key is
        // whatever it passed in, NOT the canonical UPN we admit under.
        // Invalidation has to match on the cached value too or the
        // provisional user survives and gets re-admitted every login.
        counting.respondWith(Optional.of(new FactoryPlusUser(
            "bob-uuid", "bob@OTHER.REALM", null, true)));
        cache.findByUsername("bob@other.realm");
        assertThat(counting.usernameCalls).isEqualTo(1);

        cache.admit("bob@OTHER.REALM", "bob-uuid");

        cache.findByUsername("bob@other.realm");
        assertThat(counting.usernameCalls)
            .as("The entry cached under the lower-cased key must go too")
            .isEqualTo(2);
    }

    @Test
    void admit_invalidates_the_uuid_keyspace() {
        counting.respondWith(Optional.empty());
        cache.findByUuid("bob-uuid");
        assertThat(counting.uuidCalls).isEqualTo(1);

        cache.admit("bob@OTHER.REALM", "bob-uuid");

        cache.findByUuid("bob-uuid");
        assertThat(counting.uuidCalls).isEqualTo(2);
    }

    @Test
    void admit_delegates_and_returns_the_uuid_used() {
        assertThat(cache.admit("bob@OTHER.REALM", null))
            .as("A null uuid means the delegate mints one; return it")
            .isEqualTo("minted-uuid");
        assertThat(counting.admitCalls).isEqualTo(1);
        assertThat(counting.lastAdmittedUpn).isEqualTo("bob@OTHER.REALM");
    }

    // -- helpers ---------------------------------------------------------

    /** Test double counting calls per lookup kind. */
    static final class CountingStore implements FactoryPlusUserStore {
        int uuidCalls;
        int usernameCalls;
        int emailCalls;
        int groupCalls;
        int admitCalls;
        String lastAdmittedUpn;
        Optional<FactoryPlusUser> response = Optional.empty();
        Set<String> groupResponse = Set.of();
        boolean throwOnNext = false;

        void respondWith(Optional<FactoryPlusUser> r) {
            response = r;
            throwOnNext = false;
        }

        void respondWithGroups(Set<String> g) {
            groupResponse = g;
        }

        void respondWithException() {
            throwOnNext = true;
        }

        @Override public Optional<FactoryPlusUser> findByUuid(String uuid) {
            uuidCalls++;
            return responseOrThrow();
        }
        @Override public Optional<FactoryPlusUser> findByUsername(String name) {
            usernameCalls++;
            return responseOrThrow();
        }
        @Override public Optional<FactoryPlusUser> findByEmail(String email) {
            emailCalls++;
            return responseOrThrow();
        }
        @Override public Set<String> findPermissionsForPrincipal(String uuid) {
            groupCalls++;
            return groupResponse;
        }
        @Override public String admit(String upn, String uuid) {
            admitCalls++;
            lastAdmittedUpn = upn;
            return uuid == null ? "minted-uuid" : uuid;
        }

        private Optional<FactoryPlusUser> responseOrThrow() {
            if (throwOnNext) {
                throwOnNext = false;
                throw new FactoryPlusAuthException("simulated transient failure");
            }
            return response;
        }
    }

    /** Settable Clock for deterministic TTL tests. */
    static final class MutableClock extends Clock {
        private final AtomicReference<Instant> now;

        MutableClock(Instant initial) {
            this.now = new AtomicReference<>(initial);
        }

        void advance(Duration d) {
            now.updateAndGet(t -> t.plus(d));
        }

        @Override public Instant instant() { return now.get(); }
        @Override public ZoneId getZone() { return ZoneId.of("UTC"); }
        @Override public Clock withZone(ZoneId zone) { return this; }
    }
}
