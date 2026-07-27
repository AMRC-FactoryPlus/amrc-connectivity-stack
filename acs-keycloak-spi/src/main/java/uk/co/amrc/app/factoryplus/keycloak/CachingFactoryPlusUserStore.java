/* ACS Keycloak SPI
 * TTL cache wrapper for FactoryPlusUserStore.
 *
 * Decorates a delegate store, caching both hits and misses for a fixed
 * TTL. Cached misses are important: without them, brute-force username
 * probing through Keycloak's federation chain would hammer F+ for
 * every guess.
 *
 * Exceptions thrown by the delegate are NOT cached; a transient F+
 * failure must not lock out lookups for the full TTL.
 *
 * Cache keyspaces are kept separate per lookup kind (uuid/username/
 * email) since the same string could legitimately mean different
 * things. The delegate is invoked exactly once per (kind, key, TTL
 * window) tuple.
 *
 * The Clock parameter exists purely for deterministic tests.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Supplier;

public class CachingFactoryPlusUserStore implements FactoryPlusUserStore {

    private record Entry(Optional<FactoryPlusUser> result, Instant expiresAt) {}
    private record GroupEntry(Set<String> result, Instant expiresAt) {}

    private final FactoryPlusUserStore delegate;
    private final Duration ttl;
    private final Clock clock;
    private final ConcurrentMap<String, Entry> byUuid       = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Entry> byUsername   = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Entry> byEmail      = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, GroupEntry> byGroups = new ConcurrentHashMap<>();

    public CachingFactoryPlusUserStore(FactoryPlusUserStore delegate,
                                       Duration ttl, Clock clock) {
        this.delegate = delegate;
        this.ttl = ttl;
        this.clock = clock;
    }

    @Override
    public Optional<FactoryPlusUser> findByUuid(String uuid) {
        return cached(byUuid, uuid, () -> delegate.findByUuid(uuid));
    }

    @Override
    public Optional<FactoryPlusUser> findByUsername(String username) {
        return cached(byUsername, username, () -> delegate.findByUsername(username));
    }

    @Override
    public Optional<FactoryPlusUser> findByEmail(String email) {
        return cached(byEmail, email, () -> delegate.findByEmail(email));
    }

    @Override
    public Set<String> findPermissionsForPrincipal(String uuid) {
        Instant now = clock.instant();
        GroupEntry existing = byGroups.get(uuid);
        if (existing != null && existing.expiresAt.isAfter(now)) {
            return existing.result;
        }
        Set<String> fresh = delegate.findPermissionsForPrincipal(uuid);
        byGroups.put(uuid, new GroupEntry(fresh, now.plus(ttl)));
        return fresh;
    }

    /** Delegates the write, then drops every cache entry that could
     *  still describe this user as absent or provisional.
     *
     *  <p>This is load-bearing, not hygiene. The lookup that produced
     *  the provisional user cached it under whatever string Keycloak
     *  passed in - typically a lower-cased short name, not the
     *  canonical UPN we admit under. Leaving that entry in place means
     *  the next lookup within the TTL keeps reporting the user as
     *  provisional even though the principal now exists, and any
     *  negatively cached miss keeps masking it for the full 60s. */
    @Override
    public String admit(String upn, String uuid) {
        String admitted = delegate.admit(upn, uuid);
        byUsername.remove(upn);
        byUsername.entrySet().removeIf(e -> describes(e.getValue(), upn, admitted));
        if (admitted != null) byUuid.remove(admitted);
        if (uuid != null) byUuid.remove(uuid);
        return admitted;
    }

    private static boolean describes(Entry entry, String upn, String uuid) {
        if (entry == null || entry.result().isEmpty()) return false;
        FactoryPlusUser user = entry.result().get();
        if (upn != null && upn.equalsIgnoreCase(user.username())) return true;
        return uuid != null && uuid.equals(user.uuid());
    }

    private Optional<FactoryPlusUser> cached(ConcurrentMap<String, Entry> map,
                                             String key,
                                             Supplier<Optional<FactoryPlusUser>> fetch) {
        Instant now = clock.instant();
        Entry existing = map.get(key);
        if (existing != null && existing.expiresAt.isAfter(now)) {
            return existing.result;
        }
        // Delegate may throw; do NOT poison the cache with the exception.
        Optional<FactoryPlusUser> fresh = fetch.get();
        map.put(key, new Entry(fresh, now.plus(ttl)));
        return fresh;
    }
}
