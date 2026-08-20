/* Factory+ Java client library.
 * Generic request cache.
 * Copyright 2023 AMRC.
 */

/* This is used to cache HTTP bearer tokens and to cache service URL
 * lookups. */

package uk.co.amrc.factoryplus.client;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.function.Predicate;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.json.JSONObject;

import io.reactivex.rxjava3.core.Single;

/** Internal. */
public class RequestCache<Key, Value>
{
    private static final Logger log = LoggerFactory.getLogger(RequestCache.class);

    /* An expiry of null means the entry never expires. */
    private static record Entry<V> (V value, Instant expiry)
    {
        boolean expired ()
        {
            return expiry != null && Instant.now().isAfter(expiry);
        }
    }

    private Function<Key, Single<Value>> source;
    private Duration expiry;
    private Predicate<Value> cacheable;
    private ConcurrentHashMap<Key, Entry<Value>> cache;
    private ConcurrentHashMap<Key, Single<Value>> inFlight;

    public RequestCache (Function<Key, Single<Value>> tokenSource)
    {
        this(tokenSource, null, v -> true);
    }

    /** Cache with expiry.
     *
     * Values fetched from the source are cached for the given duration,
     * then refetched on the next request. If the refetch fails the
     * stale value is returned instead, so a source outage does not
     * invalidate values we already hold. Values failing the cacheable
     * predicate are returned to the caller but not cached, so they are
     * refetched every time.
     *
     * @param tokenSource Fetches the value for a key.
     * @param expiry How long fetched values are cached for; null means
     *      forever.
     * @param cacheable Values failing this test are not cached.
     */
    public RequestCache (Function<Key, Single<Value>> tokenSource,
        Duration expiry, Predicate<Value> cacheable)
    {
        this.source = tokenSource;
        this.expiry = expiry;
        this.cacheable = cacheable;
        cache = new ConcurrentHashMap<Key, Entry<Value>>();
        inFlight = new ConcurrentHashMap<Key, Single<Value>>();
    }

    public Single<Value> get (Key key)
    {
        var existing = cache.get(key);
        if (existing != null && !existing.expired())
            return Single.just(existing.value());

        /* The fetch must not start until the promise is in the map, or
         * a synchronously-completing source will try to remove itself
         * before it has been inserted and leak a completed promise.
         * cache() defers the fetch to the first subscriber, which is
         * always after computeIfAbsent has returned. */
        var promise = inFlight.computeIfAbsent(key, k ->
            source.apply(k)
                .doOnSuccess(rv -> {
                    if (cacheable.test(rv))
                        cache.put(k, new Entry<Value>(rv,
                            expiry == null ? null
                                : Instant.now().plus(expiry)));
                })
                .doAfterTerminate(() -> inFlight.remove(k))
                .cache());

        /* If we hold an expired value, fall back to it when the refetch
         * fails rather than propagating the error. */
        if (existing != null)
            return promise.onErrorReturnItem(existing.value());
        return promise;
    }

    public void put (Key key, Value value)
    {
        /* XXX If we have an in-flight request we need to cancel it, and
         * arrange for the get() call to return this value instead.
         * Otherwise it will overwrite the value we set here. */
        /* Values set explicitly never expire. */
        cache.put(key, new Entry<Value>(value, null));
    }

    public void remove (Key service, Value token)
    {
        var existing = cache.get(service);
        if (existing != null && existing.value().equals(token))
            cache.remove(service, existing);
    }
}
