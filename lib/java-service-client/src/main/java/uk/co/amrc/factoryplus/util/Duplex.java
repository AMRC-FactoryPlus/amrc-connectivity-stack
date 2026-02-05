/*
 * Factory+ Java client library
 * Duplex Observable/Observer pair
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.util;

import io.reactivex.rxjava3.core.*;
import io.reactivex.rxjava3.functions.Function;
import io.reactivex.rxjava3.observers.DisposableObserver;

public interface Duplex<S, R>
{
    class Base<A, B> implements Duplex<A, B>
    {
        private Observer<A> sender;
        private Observable<B> receiver;

        public Base (Observer<A> sender, Observable<B> receiver)
        {
            this.sender = sender;
            this.receiver = receiver;
        }

        public Observer<A> getSender () { return this.sender; }
        public Observable<B> getReceiver () { return this.receiver; }
    }

    interface DuplexBuilder<A, B, T extends Duplex<A, B>> {
        T build(Observer<A> send, Observable<B> recv);
    }
    interface ObserverMap<A, B> {
        Observer<B> apply (Observer<A> observer);
    }
    interface ObservableMap<A, B> {
        Observable<B> apply (Observable<A> observable);
    }

    static class MapObserver<Up, Down> extends DisposableObserver<Up>
    {
        private final Observer<Down> dest;
        private final Function<Up, Down> mapper;

        public MapObserver (Observer<Down> dest, Function<Up, Down> mapper)
        {
            this.dest = dest;
            this.mapper = mapper;
        }

        @Override public void onNext (Up value)
        {
            try {
                dest.onNext(mapper.apply(value));
            }
            catch (Throwable e) {
                onError(e);
            }
        }

        @Override public void onComplete () { dest.onComplete(); }
        @Override public void onError (Throwable err) { dest.onError(err); }
    }

    Observer<S> getSender ();
    Observable<R> getReceiver ();

    default <S2, R2, T extends Duplex<S2, R2>> T compose (
        DuplexBuilder<S2, R2, T> builder,
        ObserverMap<S, S2> mapSender,
        ObservableMap<R, R2> mapReceiver)
    {
        return builder.build(
            mapSender.apply(this.getSender()),
            mapReceiver.apply(this.getReceiver()));
    }

    default <S2, R2, T extends Duplex<S2, R2>> T map (
        DuplexBuilder<S2, R2, T> builder,
        Function<S2, S> mapSender, Function<R, R2> mapReceiver)
    {
        return this.compose(
            builder,
            obs -> new MapObserver<>(obs, mapSender),
            seq -> seq.map(mapReceiver));
    }
}
