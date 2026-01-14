/*
 * Factory+ Rx client
 * HTTP response monad
 * Copyright 2024 University of Sheffield
 */

import * as imm from "immutable";

function _abstract () {
    throw new TypeError("Abstract method called");
}

const Known_Headers = imm.Set("cache-control content-type etag".split());

/** A class representing an HTTP error. */
class HTTPError extends Error {
    constructor (status, msg) {
        super(msg);
        this.status = status;
    }
}

/**
 * A class representing an HTTP response.
 *
 * An object of this class represents an HTTP response, with status
 * code, optional body and optional headers. The class supports monadic
 * operations similar to Optional, allowing manipulation of response
 * bodies dependent on status code while preserving the metadata. A
 * response is classified as 'success', 'empty' or 'failure' depending
 * on the status code.
 */
export class Response {
    /** The constructor is private */
    constructor (status, body, headers) {
        /** HTTP status code */
        this.status = status;
        /** Body (if any) */
        this.body = body;
        /** Headers as an immutable Map */
        this.headers = imm.Seq.Keyed(headers)
            .mapKeys(k => k.toString().toLowerCase())
            .filter((v, k) => Known_Headers.has(k))
            .toMap();
    }

    /** Create a Response.
     *
     * Status codes 200-299 are 'success'.
     * Status code 404 is 'empty'.
     * Other status codes are 'failure'.
     *
     * Headers are lowercased and only those significant to F+ are
     * preserved. Currently these are:
     *  cache-control
     *  content-type
     *  etag
     *
     * @param status Status code
     * @param body Body
     * @param headers Object or iterable of key-value pairs
     */
    static of (status, body, headers) {
        const klass = 
            status == 404                       ? Empty
            : status >= 200 && status < 300     ? Success
            : Failure;
        return new klass(status, body, headers);
    }

    /** Create a Response from a fetch response.
     * This is async as the fetch response body must be awaited. The
     * `json()` method will be called to retrieve the body.
     *
     * @param res A response following the Fetch standard
     */
    static async ofFetch (res) {
        const body = await res.json().catch(() => undefined);
        return this.of(res.status, body, res.headers.entries());
    }

    /** Create a Response from a notify/v2 update.
     *
     * @param update An update from a notify endpoint
     */
    static ofUpdate (update) {
        if (update.status > 299)
            throw new RangeError(
                `${update.status} notify update cannot contain a response`);
        const res = update.response;
        return this.of(res.status, res.body, res.headers);
    }

    /** Create a Response from a possibly null value.
     * Passing undefined or null returns an empty response. Other values
     * return an ok response.
     *
     * @param value Value to wrap
     */
    static ofNullable (value) {
        return value == null ? this.empty() : this.ok(value);
    }

    /** Create a successful (200) response */
    static ok (body) { return this.of(200, body); }
    /** Create an empty (404) response */
    static empty () { return this.of(404); }
    /** Create an error (500) response */
    static error (err) { return this.of(500, err); }

    /** Is this is a successful result? */
    get isOK ()     { return false; }
    /** Is this an empty result? */
    get isEmpty ()  { return false; }
    /** Is this an error result? */
    get isError ()  { return false; }

    /** Create a new Rsponse with a replacement body.
     * Preserves the headers and optionally the status code.
     * @param body New body.
     * @param st New status code, or undefined to leave unchanged.
     */
    withBody (body, st) { return Response.of(st ?? this.status, body, this.headers); }

    /** Create a new Response with a different status code.
     * Copies the headers and body from the current Response.
     * @param st New status code.
     */
    withStatus (st) { return Response.of(st, this.body, this.headers); }

    /** Transform a successful result to another Response.
     * An empty or error result is returned unchanged.
     *
     * @param fn A function from body to Response.
     */
    flatMap (fn) { return _abstract(); }

    /** Transform an empty result to another Response.
     * A success or error result is returned unchanged.
     *
     * @param fn A function from `()` to Response.
     */
    or (fn) { return _abstract(); }

    /** Transform an empty result to another Response.
     *
     * @param st The status code for the error
     * @param body The new body (optional)
     */
    orWith (st, body) { return this.or(() => this.withBody(body, st)); }

    /** Transform an error result to another Response.
     * A success or empty result is returned unchanged.
     * An error response has its status matched against the selector. If
     * it matches the function is called to generate a new response,
     * otherwise the error is returned unchanged. 
     * 
     * @param sts Passed to `immutable.Seq.Set`
     * @param fn A function from (status, body) to Response.
     */
    handle (sts, fn) { return _abstract(); }

    /** Throw if this is an error Response.
     * If this is an error response, throw an HTTPError.
     * Otherwise do nothing.
     * @param msg The error message.
     */
    throwIfError (msg) { return; }

    /** Filter successful result.
     * A success result will be passed to the predicate function; if
     * this returns `false` then an empty result will be returned.
     * Otherwise the Response is returned unchanged.
     *
     * @param pred A predicate function to test a success result
     */
    filter (pred) {
        return this.flatMap(b => pred(b) ? this : Response.empty());
    }

    /** Assert on successful result.
     * If a successful result doesn't pass the filter, return a 500
     * error result.
     *
     * @param pred The predicate to assert.
     * @param msg The optional error body.
     */
    assert (pred, msg) {
        return this.flatMap(b => pred(b) ? this : Response.error(msg));
    }

    /** Transform successful result.
     * A success result will be passed to the mapping function and a new
     * success result returned. Empty and error results are unchanged.
     *
     * @param fn The mapping function.
     */
    map (fn) {
        return this.flatMap(b => this.withBody(fn(b)));
    }

    /** Uniquefy the body.
     * Assuming the body is an Array, make the entries unique.
     * @param fn Optional mapping function to apply first.
     */
    uniq (fn) {
        fn ??= v => v;
        return this.map(l => imm.Set(l.map(fn)).toArray());
    }

    /** Assert we have a singleton Array.
     * Assert that our body is a singleton Array. Convert the body to
     * that single value.
     */
    single (msg) {
        return this.flatMap(b => 
            b.length == 1 ? this.withBody(b[0]) : Response.error(msg));
    }

    /** Transform error result.
     * As `handle` but the function just returns a new status code.
     *
     * @param sts A set of statuses to match.
     * @param fn The mapping function.
     */
    mapError (sts, fn) {
        return this.handle(sts, (...a) => this.withStatus(fn(...a)));
    }

    /** Pass our result to an Express result object.
     * If defined our body will be converted to JSON; otherwise `end()`
     * will be called.
     *
     * @param res The Express result object, or compatible.
     */
    toExpress (res) {
        res.status(this.status);
        this.headers.forEach((v, k) => res.header(k, v));
        if (this.body === undefined)
            res.end();
        else
            res.json(this.body);
    }

    /** Convert this Response to a notify/v2 update.
     * @param ix The index in the sequence of updates
     */
    toUpdate (ix) {
        return {
            status: ix ? 200 : 201, 
            response: {
                status:     this.status,
                headers:    this.headers.toJS(),
                body:       this.body,
            }};
    }

    /** Extract the body from a Response.
     * A success Response returns its body. An empty Response returns
     * `undefined`. An error Response throws an HTTPError.
     */
    get () { return _abstract(); }

    /** Extract value or default.
     * A success Response returns its body. An empty Response returns the
     * supplied value. An error Response throws an HTTPError.
     */
    orElse (val) { return _abstract(); }

    /** Call function for success or failure.
     * Omitting `failure` calls `empty` instead.
     * Omitting `empty` will return `undefined`.
     *
     * @param success Function called with the response body.
     * @param empty Function called with the status.
     * @param failure Function called with the status.
     * @returns The returh value of the callback called.
     */
    ifOK (success, empty, failure) { return _abstract(); }
}

class Success extends Response {
    get isOK ()     { return true; }

    flatMap (fn)    { return fn(this.body); }
    or (fn)         { return this; }
    handle (c, fn)  { return this; }

    get ()          { return this.body; }
    orElse (v)      { return this.body; }
    ifOK (s, e, f)  { return s(this.body); }
}

class Empty extends Response {
    get isEmpty ()  { return true; }

    flatMap (fn)    { return this; }
    or (fn)         { return fn(); }
    handle (c, fn)  { return this; }

    get ()          { return; }
    orElse (v)      { return v; }
    ifOK (s, e, f)  { return e?.(this.status); }
}

class Failure extends Response {
    get isError ()  { return true; }

    flatMap (fn)    { return this; }
    or (fn)         { return this; }

    throwIfError (msg) { throw new HTTPError(this.status, msg); }

    handle (sts, fn) {
        if (!sts || imm.Set.Seq(sts).has(this.status))
            return fn(this.status, this.body);
        return this;
    }

    get ()          { this.throwIfError(); }
    orElse ()       { this.throwIfError(); }
    ifOK (s, e, f)  { return (f ?? e)?.(this.status); }
}
