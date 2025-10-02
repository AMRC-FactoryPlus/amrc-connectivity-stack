/*
 * Optional monad
 * Copyright 2025 University of Sheffield AMRC
 */

export class Optional {
    /** Create an Optional.
     * Null or undefined return an empty Optional. */
    static of (val) {
        if (val == null)
            return EMPTY;
        else
            return new Present(val);
    }

    /** Is a value present?  */
    get isPresent () { return false; }

    /** Map a value to an Optional.
     * An empty Optional is returned unchanged. */
    flatMap (fn) { return this; }

    /** Map a value to another value.
     * An empty Optional is returned unchanged.
     * If the function returns null or undefined return an empty
     * Optional.
     * */
    map (fn) { return this.flatMap(v => Optional.of(fn(v))); }

    /** Filter the Optional.
     * If we are empty, return empty.
     * If the value fails the test, return empty.
     */
    filter (fn) { return this.flatMap(v => fn(v) ? this : EMPTY); }

    /** Substitute another Optional for an empty Optional.
     * The supplied function is called and should return an Optional.
     */
    or (fn) { return fn(); }

    /** Call callbacks for present or empty.
     * @param present Callback for present Optional.
     * @param absent Callback for empty Optional.
     * @returns The return value of the callback.
     */
    ifPresentOrElse (present, absent) { return absent(); }

    /** Get the value of the Optional.
     * An empty Optional returns null.
     */
    get () { return null; }

    /** Get the value or generate a default.
     * Return the value of a present Optional.
     * Call the function and return the value for an empty Optional.
     */
    orElseGet (fn) { return this.ifPresentOrElse(v => v, fn); }

    /** Get the value or a fixed default.
     * Return the value of a present Optional, or the default.
     */
    orElse (val) { return this.orElseGet(() => val); }

    /** Get the value or throw.
     * Call the generator function to create an exception to throw.
     */
    orElseThrow (fn) { return this.orElseGet(() => { throw fn(); }); }

}

const EMPTY = new Optional();

class Present extends Optional {
    constructor (val) {
        super();
        this.value = val;
    }

    get isPresent ()        { return true; }
    flatMap (fn)            { return fn(this.value); }
    or (fn)                 { return this; }
    get ()                  { return this.value; }
    ifPresentOrElse (p, a)  { return p(this.value); }
}
