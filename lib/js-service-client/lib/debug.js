/* 
 * Factory+ JS Service Client
 * Debugging / logging support.
 * Copyright 2022 AMRC.
 */

import * as util from "util";

/** Simple-minded logging class. */
export class Debug {
    /** Construct a logger.
     * Accepts an object of options. The only option is `verbose`, which
     * should be a string. The string will be split on comma and used as
     * the list of debug tags to print messages for. The special tag
     * `ALL` activates all tags; prefixing a tag with `!` excludes it
     * from `ALL`.
     */
    constructor (opts) {
        opts ??= {};
        const verb = opts.verbose ?? "";

        this.levels = new Set();
        this.suppress = new Set();
        this.verbose = false;

        for (const lev of verb.split(",")) {
            if (lev == "1" || lev == "ALL")
                this.verbose = true;
            else if (lev.startsWith("!"))
                this.suppress.add(lev.slice(1))
            else
                this.levels.add(lev);
        }
    }

    /** Log a message.
     * @arg level The debug tag to use for this message.
     * @arg msg The message, maybe with `util.format` codes.
     * @arg args Values to substitute for the format codes.
     */
    log (level, msg, ...args) {
        const want = this.verbose || this.levels.has(level);
        if (!want || this.suppress.has(level))
            return;
        
        const out = util.format(msg, ...args);
        const spc = " ".repeat(Math.max(0, 8 - level.length));
        console.log(`${level}${spc} : ${out}`);
    }

    /** Create a bound logger.
     * Returns a function to log a message with a given log tag.
     * @arg level The log tag to use.
     */
    bound (level) {
        return this.log.bind(this, level);
    }
}
