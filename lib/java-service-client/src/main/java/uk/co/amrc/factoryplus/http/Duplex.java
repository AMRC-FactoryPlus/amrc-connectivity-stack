/*
 * Factory+ Java client library
 * Duplex Observable/Observer pair
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.http;

import io.reactivex.rxjava3.core.*;
import io.reactivex.rxjava3.functions.Function;
import io.reactivex.rxjava3.observers.DisposableObserver;

public class Duplex<S, R>
{
    private Observer<S> sender;
    private Observable<R> receiver;

    private Duplex (Observer<S> sender, Observable<R> receiver)
    {
        this.sender = sender;
        this.receiver = receiver;
    }

    static <S, R> Duplex<S, R> of (Observer<S> sender, Observable<R> receiver)
    {
        return new Duplex(sender, receiver);
    }

    public Observer<S> getSender () { return this.sender; }
    public Observable<R> getReceiver () { return this.receiver; }

    public interface ObserverMap<A, B>
    {
        Observer<B> apply (Observer<A> observer);
    }
    public interface ObservableMap<A, B>
    {
        Observable<B> apply (Observable<A> observable);
    }

    public <S2, R2> Duplex<S2, R2> compose (
        ObserverMap<S, S2> mapSender,
        ObservableMap<R, R2> mapReceiver)
    {
        return Duplex.<S2, R2>of(mapSender.apply(this.sender),
            mapReceiver.apply(this.receiver));
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

    public <S2, R2> Duplex<S2, R2> map (
        Function<S2, S> mapSender, Function<R, R2> mapReceiver)
    {
        return this.compose(
            obs -> new MapObserver(obs, mapSender),
            seq -> seq.map(mapReceiver));
    }
}
