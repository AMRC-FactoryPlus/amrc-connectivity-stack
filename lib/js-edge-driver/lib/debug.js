/* 
 * Factory+ JS Service Client
 * Debugging / logging support.
 * Copyright 2022 AMRC.
 */

/* XXX This is copied from js-service-client. It might be better to
 * release it as its own module? Or should we replace altogether with
 * some other logger? */

import * as util from "util";

export class Debug {
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

    log (level, msg, ...args) {
        const want = this.verbose || this.levels.has(level);
        if (!want || this.suppress.has(level))
            return;
        
        const out = util.format(msg, ...args);
        const spc = " ".repeat(Math.max(0, 8 - level.length));
        console.log(`${level}${spc} : ${out}`);
    }

    bound (level) {
        return this.log.bind(this, level);
    }
}
