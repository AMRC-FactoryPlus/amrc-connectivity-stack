/*
 * Factory+ Java service client
 * HTTP response monad
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.util;

import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

import java.util.function.*;

import org.json.*;

/* This is to map headers. We don't need use this client-side yet but
 * the ConfigDB server-side should use it. I think this should be
 * another subclass, SuccessWithHeaders, I don't think failures need
 * header information. */
//        final var headers = raw_headers
//            .map(h -> h.entrySet().stream()
//                .map(e -> Map.entry(e.getKey().toLowerCase(), e.getValue()))
//                .filter(e -> KNOWN_HEADERS.contains(e.getKey()))
//                .collect(Collectors.toMap(e -> e.getKey(), e -> e.getValue())))
//            .orElse(Map.of());

public abstract class Response<T> {
    protected int status;

    private Response (int status)
    {
        this.status = status;
    }

    private static <V> Response<V> _of (int status, V body)
    {
        return
            status == 404   ? new Empty<V>() :
            status < 300    ? new Success<V>(status, body) :
            new Failure<V>(status);
    }
    
    public static <V> Response<V> of (int status)
    {
        return Response._of(status, null);
    }
    public static <V> Response<V> of (int status, V body)
    {
        return Response._of(status, body);
    }

    public static <V> Response<V> ok (V body)
    {
        return Response.of(200, body);
    }
    public static <V> Response<V> empty ()
    {
        return Response.of(404);
    }
    public static <V> Response<V> error ()
    {
        return Response.of(500);
    }

    public static <V> Response<V> ofNullable (V v)
    {
        return v == null ? Response.empty() : Response.ok(v);
    }

    public static <V> Response<V> ofOptional (Optional<V> opt)
    {
        return opt.map(Response::ok)
            .orElseGet(Response::empty);
    }

    public static Response<Object> fromJSON (JSONObject obj)
        throws JSONException
    {
        return Response.of(obj.getInt("status"), obj.opt("body"));
    }

    public String toString ()
    {
        return "Response [" + status + "]";
    }

    public boolean isOK () { return false; }
    public boolean isEmpty() { return false; }
    public boolean isError() { return false; }

    public <V> Response<V> withBody (V body)
    {
        return Response.of(this.status, body);
    }
    
    public Response<T> withStatus (int status)
    {
        return Response.of(status);
    }

    public abstract <R> Response<R> flatMap (Function<T, Response<R>> map);

    public Response<T> or (Supplier<Response<T>> supp)
    {
        return this;
    }
    public Response<T> handle (Function<Integer, Response<T>> handler)
    {
        return this;
    }
    public Response<T> handle (Set<Integer> statusses,
        Function<Integer, Response<T>> handler)
    {
        if (!statusses.contains(this.status))
            return this;
        return this.handle(handler);
    }

    public abstract T get () throws NoSuchElementException, HTTPError;
    public abstract T orElse (T val) throws HTTPError;
    public abstract <R> R ifOK (Function<T, R> success,
        Supplier<R> empty, Function<Integer, R> failure);

    public <R> R ifOK (Function<T, R> success, Function<Integer, R> failure)
    {
        return this.ifOK(success, () -> failure.apply(404), failure);
    }

    public void doIfOK (Consumer<T> success, Consumer<Integer> failure)
    {
        this.<Object>ifOK(v -> { success.accept(v); return null; },
            () -> { failure.accept(404); return null; },
            s -> { failure.accept(s); return null; });
    }

    public void doIfOK (Consumer<T> success)
    {
        this.doIfOK(success, s -> {});
    }

    public Response<T> orWith (int st, T body)
    {
        return this.or(() -> Response.of(st, body));
    }

    public void throwIfError (String msg) throws HTTPError { return; }

    public Response<T> filter (Predicate<T> pred)
    {
        return this.flatMap(b -> pred.test(b) ? this : Response.empty());
    }

    public <V> Response<V> map (Function<T, V> mapper)
    {
        return this.flatMap(b -> this.withBody(mapper.apply(b)));
    }

    public <C> Response<C> cast (Class<C> klass)
    {
        return this.map(klass::cast);
    }

    static class Success<T> extends Response<T>
    {
        private T body;

        protected Success (int status, T body)
        {
            super(status);
            this.body = body;
        }

        public String toString ()
        {
            return super.toString() + ": " + 
                (body == null ? "null" : body.toString());
        }

        public Response<T> withStatus (int status)
        {
            return Response.of(status, this.body);
        }

        public boolean isOK () { return true; }

        public <R> Response<R> flatMap(Function<T, Response<R>> map)
        {
            return map.apply(this.body);
        }

        public T get () { return this.body; }
        public T orElse (T v) { return this.body; }
        public <R> R ifOK (Function<T, R> success,
            Supplier<R> empty, Function<Integer, R> failure)
        {
            return success.apply(this.body);
        }
    }

    static class Empty<T> extends Response<T>
    {
        protected Empty ()
        {
            super(404);
        }

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

        public int getStatus () { return status; }
    }

    static class Failure<T> extends Response<T>
    {
        protected Failure (int status)
        {
            super(status);
        }

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

        public T get () throws HTTPError { throwIfError(""); return null; }
        public T orElse (T v) throws HTTPError { throwIfError(""); return null; }

        public <R> R ifOK (Function<T, R> success,
            Supplier<R> empty, Function<Integer, R> failure)
        {
            return failure.apply(this.status);
        }
    }
}
