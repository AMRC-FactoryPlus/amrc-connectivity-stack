/*
 * Factory+ Java service client
 * Sequence cache helper
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.util;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

import io.reactivex.rxjava3.core.Observable;

/** Wrap a sequence-generating function and cache the results.
 * We don't have real closures in Java, so we need to be explicit with
 * our state. Multicasting via BehaviorSubject is not supported in
 * RxJava so this does not support initial values at the moment.
 */
public class CacheSeq<K, V>
{
    private ConcurrentHashMap<K, Observable<V>> cache;
    private Builder<K, V> builder;

    public static class Builder<A, B>
    {
        private Function<A, Observable<B>> factory;
        private long timeout;
        private TimeUnit unit;
        //private Optional<B> initial;
        private boolean replay;

        Builder (Function<A, Observable<B>> factory)
        {
            this.factory = factory;
            this.timeout = 5;
            this.unit = TimeUnit.SECONDS;
            //this.initial = Optional.empty();
            this.replay = false;
        }

        public Builder<A, B> withTimeout (long timeout, TimeUnit unit)
        {
            this.timeout = timeout;
            this.unit = unit;
            return this;
        }

//        public Builder<A, B> withInitialBalue (B value)
//        {
//            this.initial = Optional.of(value);
//            return this;
//        }

        public Builder<A, B> withReplay ()
        {
            this.replay = true;
            return this;
        }

        public CacheSeq<A, B> build ()
        {
            return new CacheSeq<>(this);
        }
    }

    public static <K, V> Builder<K, V> builder (Function<K, Observable<V>> factory)
    {
        return new Builder<>(factory);
    }

    public static <K, V> CacheSeq<K, V> of (Function<K, Observable<V>> factory)
    {
        return builder(factory).build();
    }

    private CacheSeq (Builder<K, V> builder)
    {
        this.cache = new ConcurrentHashMap<>();
        this.builder = builder;
    }

    public Observable<V> get (K key)
    {
        return Observable.defer(() ->
            cache.computeIfAbsent(key, this::newSeq));
    }

    private Observable<V> newSeq (K key)
    {
        var seq = builder.factory.apply(key)
            .doFinally(() -> cache.remove(key));

        var pub = builder.replay ? seq.replay(1) : seq.publish();
        return pub.refCount(builder.timeout, builder.unit);
    }
}
