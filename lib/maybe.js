/*
 * Factory+ Rx client
 * HTTP Maybe monad
 * Copyright 2024 University of Sheffield
 */

/* XXX I don't entirely like the name conflict with RxJava's Maybe,
 * which is the sequence version of this, nor with Haskell's Maybe,
 * which is Java's Optional. There are too many concepts and not enough
 * good names.
 */

export class HTTPError extends Error {
    constructor (status) {
        super(`HTTP error ${status}`);
        this.status = status;
    }
}

export class Maybe {
    static success (val) { return new Success(val); }
    static empty () { return new Empty(); }
    static error (err) { return new Failure(err); }

    static of (v) {
        return v == null ? Maybe.empty() : Maybe.success(v);
    }
    static ofError (v, e) {
        return e ? Maybe.error(e) : Maybe.of(v);
    }
    static ofHttp (res) {
        if (res.status < 300)
            return Maybe.of(res);
        if (res.status == 404)
            return Maybe.empty();
        return Maybe.error(new HTTPError(res.status));
    }

    get isOK ()     { return false; }
    get isEmpty ()  { return false; }
    get isError ()  { return false; }

    filter (pred) {
        return this.flatMap(b => pred(b) ? this : Maybe.empty());
    }

    map (fn) {
        return this.flatMap(b => Maybe.of(fn(b)));
    }

    mapError (cls, fn) {
        return this.handle(cls, e => Maybe.error(fn(e)));
    }
}

class Success extends Maybe {
    constructor (val) {
        super();
        this.value = val;
    }

    get isOK ()     { return true; }

    flatMap (fn)    { return fn(this.value); }
    or (fn)         { return this; }
    handle (c, fn)  { return this; }

    get ()          { return this.value; }
    orElse (v)      { return this.value; }
    ifOK (fn)       { return fn(this.value); }
}

class Empty extends Maybe {
    get isEmpty ()  { return true; }

    flatMap (fn)    { return this; }
    or (fn)         { return fn(); }
    handle (c, fn)  { return this; }

    get ()          { return; }
    orElse (v)      { return v; }
    ifOK (fn, err)  { return err?.(); }
}

class Failure extends Maybe {
    constructor (err) {
        super();
        this.error = err;
    }

    flatMap (fn)    { return this; }
    or (fn)         { return this; }

    handle (cls, fn) {
        if (this.error instanceof cls)
            return fn(this.error);
        return this;
    }

    get ()          { throw this.error; }
    orElse ()       { throw this.error; }
    ifOK (fn, err)  { return err?.(this.error); }
}
