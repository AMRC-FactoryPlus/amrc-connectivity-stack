/* Factory+ Java client library.
 * Generic request cache.
 * Copyright 2023 AMRC.
 */

/* This is used to cache HTTP bearer tokens and to cache service URL
 * lookups. */

package uk.co.amrc.factoryplus;

import java.net.URI;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.json.JSONObject;

import io.reactivex.rxjava3.core.Single;

/** Internal. */
public class RequestCache<Key, Value>
{
    private static final Logger log = LoggerFactory.getLogger(RequestCache.class);

    private Function<Key, Single<Value>> source;
    private ConcurrentHashMap<Key, Value> cache;
    private ConcurrentHashMap<Key, Single<Value>> inFlight;

    public RequestCache (Function<Key, Single<Value>> tokenSource)
    {
        source = tokenSource;
        cache = new ConcurrentHashMap<Key, Value>();
        inFlight = new ConcurrentHashMap<Key, Single<Value>>();
    }

    public Single<Value> get (Key key)
    {
        var existing = cache.get(key);
        if (existing != null)
            return Single.just(existing);

        return inFlight.computeIfAbsent(key, k -> {
            var promise = source.apply(key).cache();
            //log.info("In-flight: add {} {}", key, promise);

            promise
                .doAfterTerminate(() -> {
                    //log.info("In-flight: remove {} {}", key, promise);
                    inFlight.remove(key, promise);
                })
                .subscribe(rv -> cache.put(key, rv), e -> {});
            return promise;
        });
    }

    public void put (Key key, Value value)
    {
        /* XXX If we have an in-flight request we need to cancel it, and
         * arrange for the get() call to return this value instead.
         * Otherwise it will overwrite the value we set here. */
        cache.put(key, value);
    }

    public void remove (Key service, Value token)
    {
        cache.remove(service, token);
    }
}
