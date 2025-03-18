package uk.co.amrc.factoryplus;

import io.reactivex.rxjava3.core.Single;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.*;
import java.util.function.Function;

public class RequestCache<Key, Value> {
    private final ConcurrentHashMap<Key, Value> cache;
    private final ConcurrentHashMap<Key, Single<Value>> inFlight;
    private final Function<Key, Single<Value>> source;
    private final ConcurrentHashMap<Key, Long> timestamps;
    private ScheduledExecutorService scheduler;
    private static final Logger log = LoggerFactory.getLogger(RequestCache.class);
    private long expiryTimeMillis = 0;

    /**
     * Creates request cache WITHOUT cache expiration.
     * @param tokenSource Function to get the value to cache.
     */
    public RequestCache(Function<Key, Single<Value>> tokenSource) {
        this.cache = new ConcurrentHashMap<>();
        this.timestamps = new ConcurrentHashMap<>();
        this.inFlight = new ConcurrentHashMap<>();
        this.source = tokenSource;
    }

    /**
     * Creates request cache WITH cache expiration.
     * @param expiryTimeMinutes Expiry time of the cache.
     * @param tokenSource Function to get the value to cache.
     */
    public RequestCache(long expiryTimeMinutes, Function<Key, Single<Value>> tokenSource) {
        this(tokenSource);
        this.expiryTimeMillis = expiryTimeMinutes * 60 * 1000;
        this.scheduler = Executors.newScheduledThreadPool(1);
        startCacheCleanupTask();
    }

    /**
     * Gets the value from cache if available or get the latest value from the api if not present.
     * @param key Key of the value to retrieve.
     * @return The cached value.
     */
    public Single<Value> getOrFetch(Key key) {
        var cachedValue = get(key);
        if (cachedValue != null) {
            //log.info("Cached value found for key " + key);
            return Single.just(cachedValue);
        }
        //log.info("No cached value found for key " + key);
        return inFlight.computeIfAbsent(key, k -> {
            var promise = source.apply(key).cache();
            //log.info("In-flight: add {} {}", key, promise);
            promise
                    .doAfterTerminate(() -> {
                        //log.info("In-flight: remove {} {}", key, promise);
                        inFlight.remove(key, promise);
                    })
                    .subscribe(rv -> put(key, rv), e -> {});
            return promise;
        });
    }

    public void put(Key key, Value value) {
        cache.put(key, value);
        timestamps.put(key, System.currentTimeMillis());
    }

    private Value get(Key key) {
        if (expiryTimeMillis > 0 && isExpired(key)) {
            remove(key);
            return null;
        }
        return cache.get(key);
    }

    public void remove(Key key) {
        cache.remove(key);
        timestamps.remove(key);
    }

    private boolean isExpired(Key key) {
        Long storedTime = timestamps.get(key);
        return storedTime == null || (System.currentTimeMillis() - storedTime) > expiryTimeMillis;
    }

    private void startCacheCleanupTask() {
        scheduler.scheduleAtFixedRate(() -> {
            long now = System.currentTimeMillis();
            for (Key key : timestamps.keySet()) {
                if (now - timestamps.get(key) > expiryTimeMillis) {
                    //log.info("Removing key from cache: {}", key);
                    remove(key);
                }
            }
        }, 1, 1, TimeUnit.MINUTES);
    }

    /**
     * Stops the scheduler from running the cache clean-up job.
     */
    public void shutdown() {
        if(scheduler != null) {
            scheduler.shutdown();
        }
    }
}
