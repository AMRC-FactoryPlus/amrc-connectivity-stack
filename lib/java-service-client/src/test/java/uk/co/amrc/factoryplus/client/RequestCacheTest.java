/* Factory+ Java client library.
 * Request cache tests.
 * Copyright 2026 University of Sheffield
 */

package uk.co.amrc.factoryplus.client;

import java.time.Duration;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

import io.reactivex.rxjava3.core.Single;

public class RequestCacheTest {

    /* A source which counts its calls and returns whatever Single is
     * currently configured. */
    private static class Source {
        AtomicInteger calls = new AtomicInteger();
        AtomicReference<Single<String>> result =
            new AtomicReference<>(Single.just("value"));

        Single<String> fetch (String key)
        {
            return Single.defer(() -> {
                calls.incrementAndGet();
                return result.get();
            });
        }
    }

    @Test
    public void cachesSuccessfulResults ()
    {
        var src = new Source();
        var cache = new RequestCache<String, String>(src::fetch);

        assertEquals("value", cache.get("key").blockingGet());
        assertEquals("value", cache.get("key").blockingGet());
        assertEquals(1, src.calls.get());
    }

    @Test
    public void doesNotCacheErrors ()
    {
        var src = new Source();
        var cache = new RequestCache<String, String>(src::fetch);

        src.result.set(Single.error(new Exception("directory down")));
        assertThrows(Exception.class,
            () -> cache.get("key").blockingGet());

        src.result.set(Single.just("value"));
        assertEquals("value", cache.get("key").blockingGet());
        assertEquals(2, src.calls.get());
    }

    @Test
    public void doesNotCacheUncacheableValues ()
    {
        var src = new Source();
        var cache = new RequestCache<String, String>(src::fetch,
            null, v -> !v.isEmpty());

        src.result.set(Single.just(""));
        assertEquals("", cache.get("key").blockingGet());
        assertEquals("", cache.get("key").blockingGet());
        assertEquals(2, src.calls.get());

        src.result.set(Single.just("value"));
        assertEquals("value", cache.get("key").blockingGet());
        assertEquals("value", cache.get("key").blockingGet());
        assertEquals(3, src.calls.get());
    }

    @Test
    public void refetchesAfterExpiry () throws Exception
    {
        var src = new Source();
        var cache = new RequestCache<String, String>(src::fetch,
            Duration.ofMillis(20), v -> true);

        assertEquals("value", cache.get("key").blockingGet());
        Thread.sleep(50);
        src.result.set(Single.just("new value"));
        assertEquals("new value", cache.get("key").blockingGet());
        assertEquals(2, src.calls.get());
    }

    @Test
    public void servesStaleValueWhenRefetchFails () throws Exception
    {
        var src = new Source();
        var cache = new RequestCache<String, String>(src::fetch,
            Duration.ofMillis(20), v -> true);

        assertEquals("value", cache.get("key").blockingGet());
        Thread.sleep(50);
        src.result.set(Single.error(new Exception("directory down")));
        assertEquals("value", cache.get("key").blockingGet());
        assertEquals(2, src.calls.get());
    }

    @Test
    public void putValuesNeverExpire () throws Exception
    {
        var src = new Source();
        var cache = new RequestCache<String, String>(src::fetch,
            Duration.ofMillis(20), v -> true);

        cache.put("key", "pinned");
        Thread.sleep(50);
        assertEquals("pinned", cache.get("key").blockingGet());
        assertEquals(0, src.calls.get());
    }

    @Test
    public void removeOnlyRemovesMatchingValue ()
    {
        var src = new Source();
        var cache = new RequestCache<String, String>(src::fetch);

        cache.put("key", "pinned");
        cache.remove("key", "other");
        assertEquals("pinned", cache.get("key").blockingGet());
        assertEquals(0, src.calls.get());

        cache.remove("key", "pinned");
        assertEquals("value", cache.get("key").blockingGet());
        assertEquals(1, src.calls.get());
    }
}
