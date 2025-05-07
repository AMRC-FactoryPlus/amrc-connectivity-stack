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

/**
 * An exception class representing an HTTP error.
 */
export class HTTPError extends Error {
    /** Create an HTTPError.
     * @param status An HTTP status code
     */
    constructor (status) {
        super(`HTTP error ${status}`);
        this.status = status;
    }
}

function _abstract () {
    throw new TypeError("Base Maybe is an abstract type");
}

/**
 * A class representing success, failure or no-result.
 *
 * This class is a monad, related to Optional, which also allows the
 * possibility of an error result. The `map` and `flatMap` methods allow
 * processing a successful result without affecting an empty or error
 * result. The `handle` method allows handling errors.
 */
export class Maybe {
    /** Create a successful Maybe.
     * @param val The value in the Maybe.
     */
    static success (val) { return new Success(val); }
    /** Create an empty Maybe. */
    static empty () { return new Empty(); }
    /** Create a Maybe representing an error.
     * @param err A value representing the error, normally an Error.
     */
    static error (err) { return new Failure(err); }

    /** Create a Maybe.
     * If passed a defined error, creates an error Maybe.
     * If passed a null or undefined value, creates an empty Maybe.
     * Otherwise creates a successful Maybe.
     *
     * @param val The value to examine if no error.
     * @param err A error, or undefined.
     */
    static of (val, err) {
        return err === undefined
            ? val == null ? Maybe.empty() : Maybe.success(val)
            : Maybe.error(err);
    }
    /** Create a Maybe from an HTTP response or similar.
     * Expects an object with a numeric `status` property. If this is
     * less than 300, returns success. If this is equal to 404, returns
     * empty. Otherwise returns error, using the HTTPError exception.
     *
     * @param res An object containing an HTTP status code.
     */
    static ofHttp (res) {
        if (res.status < 300)
            return Maybe.of(res);
        if (res.status == 404)
            return Maybe.empty();
        return Maybe.error(new HTTPError(res.status));
    }

    /** Is this is a successful result? */
    get isOK ()     { return false; }
    /** Is this an empty result? */
    get isEmpty ()  { return false; }
    /** Is this an error result? */
    get isError ()  { return false; }

    /** Transform a successful result to another Maybe.
     * An empty or error result is returned unchanged.
     *
     * @param fn A function from value to Maybe.
     */
    flatMap (fn) { return _abstract(); }

    /** Transform an empty result to another Maybe.
     * A success or error result is returned unchanged.
     *
     * @param fn A function from `()` to Maybe.
     */
    or (fn) { return _abstract(); }

    /** Transform an error result to another Maybe.
     * A success or empty result is returned unchanged.
     * If a class selector is supplied, only errors which are
     * `instanceof` that class are handled. Other errors are returned
     * unchanged.
     *
     * @param cls A class selector, or `null`.
     * @param fn A function from error to Maybe.
     */
    handle (cls, fn) { return _abstract(); }

    /** Filter successful result.
     * A success result will be passed to the predicate function; if
     * this returns `false` then an empty result will be returned.
     * Otherwise the Maybe is returned unchanged.
     *
     * @param pred A predicate function to test a success result
     */
    filter (pred) {
        return this.flatMap(b => pred(b) ? this : Maybe.empty());
    }

    /** Transform successful result.
     * A success result will be passed to the mapping function and a new
     * success result returned. Empty and error results are unchanged. A
     * `null` or `undefined` return value from the mapping function will
     * return an empty Maybe.
     *
     * @param fn The mapping function.
     */
    map (fn) {
        return this.flatMap(b => Maybe.of(fn(b)));
    }

    /** Transform error result.
     * An error result will be matched against the error class and then
     * passed to the mapping function; the return value will be
     * re-wrapped in an error Maybe. Success and empty Maybes will be
     * returned unchanged.
     *
     * @param cls A class selector, or `null`.
     * @param fn The mapping function.
     */
    mapError (cls, fn) {
        return this.handle(cls, e => Maybe.error(fn(e)));
    }

    /** Extract value from Maybe.
     * A success Maybe returns its value. An empty Maybe returns
     * `undefined`. An error Maybe throws its error.
     */
    get () { return _abstract(); }

    /** Extract value or default.
     * A success Maybe returns its value. An empty Maybe returns the
     * supplied value. An error Maybe throws its error.
     */
    orElse () { return _abstract(); }

    /** Call function for success or failure.
     * On success, the first function is called with the Maybe's value.
     * On empty, the second function is called with no arguments. On
     * error the second function is called with the error.
     *
     * The second function is optional. Omitting it will return
     * `undefined`.
     *
     * @param success Function to call on success.
     * @param failure Function to call on empty or error.
     */
    ifOK (success, failure) { return _abstract(); }
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
        if (!cls || this.error instanceof cls)
            return fn(this.error);
        return this;
    }

    get ()          { throw this.error; }
    orElse ()       { throw this.error; }
    ifOK (fn, err)  { return err?.(this.error); }
}
