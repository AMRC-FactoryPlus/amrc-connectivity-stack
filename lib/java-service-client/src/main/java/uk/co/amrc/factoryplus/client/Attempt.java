/* Factory+ Java client library.
 * Value-or-error monad
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.client;

import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.concurrent.Callable;

import io.reactivex.rxjava3.functions.Function;
import io.reactivex.rxjava3.functions.Supplier;
import io.reactivex.rxjava3.core.Single;

public abstract class Attempt<T> {
    public static <T> Attempt<T> of (T value)
    {
        Objects.requireNonNull(value);
        return new AttemptSuccess<T>(value);
    }
    public static <T> Attempt<T> ofError (Throwable error)
    {
        Objects.requireNonNull(error);
        return new AttemptFailure<T>(error);
    }

    public static <T> Attempt<T> create (Supplier<Attempt<T>> fn)
    {
        Objects.requireNonNull(fn);
        try {
            return fn.get();
        }
        catch (Throwable err) {
            return Attempt.ofError(err);
        }
    }
    public static <T> Attempt<T> ofSupplier (Supplier<T> fn)
    {
        Objects.requireNonNull(fn);
        return Attempt.create(() -> Attempt.of(fn.get()));
    }
    public static <T> Attempt<T> ofCallable (Callable<T> fn)
    {
        Objects.requireNonNull(fn);
        return Attempt.create(() -> Attempt.of(fn.call()));
    }

    public abstract boolean isPresent ();
    public abstract boolean isError ();
    public abstract T get ();
    public abstract Throwable getError ();
    public abstract T orElse (java.util.function.Function<Throwable,T> fn);
    public abstract T orElseThrow () throws Throwable;

    public abstract <R> Attempt<R> flatMap (Function<T,Attempt<R>> fn);
    public abstract <R> Attempt<R> map (Function<T,R> fn);
    public abstract Attempt<T> or (Function<Throwable,Attempt<T>> fn);
    public abstract <E> Attempt<T> handle (
        Class<E> cls, Function<E,Attempt<T>> fn);
    public abstract <E> Attempt<T> mapError (
        Class<E> cls, Function<E,Throwable> fn);

    public abstract Single<T> toSingle ();
}

class AttemptSuccess<T> extends Attempt<T> {
    private T value;

    public AttemptSuccess (T value)
    {
        this.value = value;
    }

    public boolean isPresent () { return true; }
    public boolean isError () { return false; }

    public T get () { return value; }
    public Throwable getError () { throw new NoSuchElementException(); }
    public T orElse (java.util.function.Function<Throwable,T> fn) {
        return value;
    }
    public T orElseThrow () throws Throwable { return value; }

    public <R> Attempt<R> flatMap (Function<T,Attempt<R>> fn)
    {
        Objects.requireNonNull(fn);
        return Attempt.create(() -> fn.apply(value));
    }
    public <R> Attempt<R> map (Function<T,R> fn)
    {
        Objects.requireNonNull(fn);
        return this.flatMap(v -> Attempt.of(fn.apply(v)));
    }
    public Attempt<T> or (Function<Throwable,Attempt<T>> fn) { return this; }
    public <E> Attempt<T> handle (Class<E> cls, Function<E,Attempt<T>> fn) 
        { return this; }
    public <E> Attempt<T> mapError (Class<E> cls, Function<E,Throwable> fn)
        { return this; }

    public Single<T> toSingle () { return Single.just(value); }
}

class AttemptFailure<T> extends Attempt<T> {
    private Throwable error;

    public AttemptFailure (Throwable error)
    {
        this.error = error;
    }

    public boolean isPresent () { return false; }
    public boolean isError () { return true; }

    public T get () { throw new NoSuchElementException(error); }
    public Throwable getError () { return error; }
    public T orElse (java.util.function.Function<Throwable,T> fn) {
        return fn.apply(error);
    }
    public T orElseThrow () throws Throwable { throw error; }

    public <R> Attempt<R> flatMap (Function<T,Attempt<R>> fn)
    {
        return Attempt.<R>ofError(error);
    }
    public <R> Attempt<R> map (Function<T,R> fn)
    {
        return Attempt.<R>ofError(error);
    }
    public Attempt<T> or (Function<Throwable,Attempt<T>> fn)
    {
        return Attempt.create(() -> fn.apply(error));
    }
    public <E> Attempt<T> handle (Class<E> cls, Function<E,Attempt<T>> fn)
    {
        if (!cls.isInstance(error)) return this;
        return Attempt.create(() -> fn.apply(cls.cast(error)));
    }
    public <E> Attempt<T> mapError (Class<E> cls, Function<E,Throwable> fn)
    {
        return handle(cls, e -> 
            Attempt.<T>ofError(fn.apply(cls.cast(e))));
    }

    public Single<T> toSingle () { return Single.error(error); }
}
