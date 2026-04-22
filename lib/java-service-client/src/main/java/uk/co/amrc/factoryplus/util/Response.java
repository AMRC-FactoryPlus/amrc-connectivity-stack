/*
 * Factory+ Java service client
 * HTTP response monad
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.util;

import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import java.util.function.*;

/* XXX We need to support both JSON libraries for now. Ideally the
 * org.json lib should be refactored out. */
import jakarta.json.*;
import org.json.*;

import io.reactivex.rxjava3.core.Observable;
import io.reactivex.rxjava3.core.Maybe;

import io.vavr.collection.List;
import io.vavr.collection.HashMap;
import io.vavr.collection.Map;
import io.vavr.control.Option;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.client.FPServiceException;

/* XXX This should be refactored to hold a Throwable in the error case.
 * I think perhaps
 *  - we only hold a status code in the success case,
 *  - we hold a Throwable in the error case,
 *  - the factories build an HTTPError with a status code in
 *  - but this can be mapped to other error types as needed.
 * We also need to deal better with empty bodies. If we remove the
 * status field from the superclass this makes the constructor handling
 * easier; and in fact we can become an interface.
 */

public interface Response<T> {
    static <V> Response<V> of (int status)
    {
        return Response.of(status, null);
    }
    static <V> Response<V> of (int status, V body)
    {
        if (status == 404)
            return Response.empty();
        if (status >= 300)
            return Response.error(status);
        return Response.success(status, body);
    }

    static <V> Response<V> success (int status, V body)
    {
        return new Success<V>(status, HashMap.empty(), Option.of(body));
    }
    static <V> Response<V> ok (V body)          { return Response.success(200, body); }
    static <V> Response<V> empty ()             { return new Empty<V>(); }
    static <V> Response<V> error (int status)   { return new Failure<V>(status); }
    static <V> Response<V> error ()             { return Response.error(500); }

    static <V> Response<V> ofNullable (V v)
    {
        return v == null ? Response.empty() : Response.ok(v);
    }
    static <V> Response<V> ofOptional (Optional<V> opt)
    {
        return opt.map(Response::ok)
            .orElseGet(Response::empty);
    }
    static Response<Object> fromJSON (JSONObject obj)
        throws JSONException
    {
        return Response.of(obj.getInt("status"), obj.opt("body"));
    }

    int status ();
    default Map<String, String> headers () { return HashMap.empty(); }
    default Option<T> body () { return Option.none(); }

    default boolean isOK () { return false; }
    default boolean isEmpty() { return false; }
    default boolean isError() { return false; }

    default Optional<T> toOptional ()
    {
        return this.ifOK(Optional::of, Optional::empty);
    }
    default List<T> toVavrList ()
    {
        return this.ifOK(List::of, List::empty);
    }
    default Maybe<T> toMaybe (Function<Integer, Throwable> mkerror)
    {
        return this.ifOK(Maybe::just, Maybe::empty,
            st -> Maybe.error(mkerror.apply(st)));
    }
    default Maybe<T> toMaybe ()
    {
        return this.toMaybe(HTTPError::new);
    }
    default JsonValue toJson ()
    {
        var obj = Json.createObjectBuilder()
            .add("status", status());

        /* The ClassCastException here is deliberate */
        body().peek(b -> obj.add("body", (JsonValue)b));

        if (!headers().isEmpty()) {
            var h = Json.createObjectBuilder();
            headers().forEach(h::add);
            obj.add("headers", h.build());
        }

        return obj.build();
    }

    default <V> Response<V> withBody (V body)
    {
        return Response.of(status(), body);
    }
    default Response<T> withStatus (int status)
    {
        return Response.of(status);
    }
    default Response<T> withHeaders (Map<String, String> headers)
    {
        /* Non-success Responses may not have headers */
        return this;
    }

    /* This could potentially default to a cast? */
    <R> Response<R> flatMap (Function<T, Response<R>> map);
    default Response<T> or (Supplier<Response<T>> supp) { return this; }
    default Response<T> handle (Function<Integer, Response<T>> handler) { return this; }

    default Response<T> orItem (Supplier<T> supp)
    {
        return this.or(() -> Response.ok(supp.get()));
    }

    default Response<T> handle (Set<Integer> statusses,
        Function<Integer, Response<T>> handler)
    {
        if (!statusses.contains(status()))
            return this;
        return this.handle(handler);
    }

    T get () throws NoSuchElementException, HTTPError;
    T orElse (T val) throws HTTPError;
    <R> R ifOK (Function<T, R> success, Supplier<R> empty, Function<Integer, R> failure);

    default <R> R ifOK (Function<T, R> success, Function<Integer, R> failure)
    {
        return this.ifOK(success, () -> failure.apply(404), failure);
    }
    default <R> R ifOK (Function<T, R> success, Supplier<R> failure)
    {
        return this.ifOK(success, failure, s -> failure.get());
    }

    default void doIfOK (Consumer<T> success, Consumer<Integer> failure)
    {
        this.<Object>ifOK(v -> { success.accept(v); return null; },
            () -> { failure.accept(404); return null; },
            s -> { failure.accept(s); return null; });
    }
    default void doIfOK (Consumer<T> success)
    {
        this.doIfOK(success, s -> {});
    }

    default Response<T> orWith (int st, T body)
    {
        return this.or(() -> Response.of(st, body));
    }

    default void throwIfError (String msg) throws HTTPError { return; }

    default Response<T> filter (Predicate<T> pred)
    {
        return this.flatMap(b -> pred.test(b) ? this : Response.empty());
    }
    default <V> Response<V> map (Function<T, V> mapper)
    {
        return this.flatMap(b -> this.withBody(mapper.apply(b)));
    }
    default <C> Response<C> cast (Class<C> klass)
    {
        return this.map(klass::cast);
    }

    /* We have a nasty special case here: a 204 is a Success with no
     * body. Currently we handle this with a null body, which I don't
     * like. But I'm not sure what the correct semantics are for flatMap
     * with an empty body. */
    static record Success<T> (int status, Map<String, String> headers, Option<T> body)
        implements Response<T>
    {
        private T bodyOrNull () { return body.getOrElse((T)null); }

        public Response<T> withStatus (int status)
        {
            return Response.of(status, bodyOrNull());
        }
        public Response<T> withHeaders (Map<String, String> headers)
        {
            return new Success<T>(this.status, headers, this.body);
        }

        public boolean isOK () { return true; }

        public <R> Response<R> flatMap(Function<T, Response<R>> map)
        {
            return map.apply(bodyOrNull());
        }

        public T get () { return bodyOrNull(); }
        public T orElse (T v) { return bodyOrNull(); }
        public <R> R ifOK (Function<T, R> success,
            Supplier<R> empty, Function<Integer, R> failure)
        {
            return success.apply(bodyOrNull());
        }
    }

    static class Empty<T> implements Response<T>
    {
        public int status () { return 404; }
        public boolean isEmpty () { return true; }

        public <R> Response<R> flatMap(Function<T, Response<R>> map)
        {
            return Response.empty();
        }
        public Response<T> or (Supplier<Response<T>> supp)
        {
            return supp.get();
        }

        public T get () { throw new NoSuchElementException(); }
        public T orElse (T v) { return v; }
        public <R> R ifOK (Function<T, R> success,
            Supplier<R> empty, Function<Integer, R> failure)
        {
            return empty.get();
        }
    }

    static class HTTPError extends Exception
    {
        private int status;

        public HTTPError (int status, String msg)
        {
            super(msg);
            this.status = status;
        }

        public HTTPError (int status)
        {
            this(status, "HTTP error " + status);
        }

        public int getStatus () { return status; }

        public FPServiceException toServiceError (UUID service)
        {
            return new FPServiceException(service, status, getMessage());
        }
    }

    static record Failure<T> (int status) implements Response<T>
    {
        public boolean isError () { return true; }

        public <R> Response<R> flatMap(Function<T, Response<R>> map)
        {
            return Response.of(this.status);
        }
        public Response<T> handle (Function<Integer, Response<T>> handler)
        {
            return handler.apply(this.status);
        }

        public void throwIfError (String msg) throws HTTPError
        {
            throw new HTTPError(this.status, msg);
        }

        private HTTPError _mkerr ()
        {
            return new HTTPError(this.status);
        }

        public T get () throws HTTPError { throw _mkerr(); }
        public T orElse (T v) throws HTTPError { throw _mkerr(); }

        public <R> R ifOK (Function<T, R> success,
            Supplier<R> empty, Function<Integer, R> failure)
        {
            return failure.apply(this.status);
        }
    }
}
