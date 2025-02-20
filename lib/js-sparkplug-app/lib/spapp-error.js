/* ACS Sparkplug App library.
 * Sparkplug App exception class.
 * Copyright 2023 AMRC.
 */

export class SPAppError extends Error {
    constructor (msg, opts) {
        super(msg, opts);
    }
}
