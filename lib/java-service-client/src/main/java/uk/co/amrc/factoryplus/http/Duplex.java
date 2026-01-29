/*
 * Factory+ Java client library
 * Duplex Observable/Observer pair
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.http;

import java.util.function.Function;

import io.reactivex.rxjava3.core.*;

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

    public <T> Duplex<T, R> lift (Function<Observer<S>, Observer<T>> map)
    {
        return Duplex.of(map.apply(this.sender), this.receiver);
    }

    public <T> Duplex<S, T> compose (Function<Observable<R>, Observable<T>> map)
    {
        return Duplex.of(this.sender, map.apply(this.receiver));
    }
}
