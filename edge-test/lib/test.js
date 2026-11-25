/*
 * Edge Agent testing driver
 * Copyright 2024 AMRC
 */

import { funcs, packing, split_addr } from "./addr.js";
import { read_test, scout_test } from "./scout.js";

export class TestHandler {
    /* Edge Scout lists a made-up tree of addresses. See scout.js. */
    static scouts = true;
    /* Live values read each address's function at a fixed time. */
    static reads = true;

    static create (driver, conf) {
        return new this(conf);
    }

    constructor (conf) {
        this.conf = conf && typeof conf == "object" ? conf : {};
    }

    async connect () {
        return "UP";
    }

    parseAddr (spec) {
        const parts = split_addr(spec);
        if (!parts) return;

        const pack = packing[parts.pack];
        return {
            func:   funcs[parts.func](parts.period, parts.amplitude),
            size:   pack[0],
            pack:   pack[1],
        };
    }

    async poll (addr) {
        const val = addr.func(performance.now());
        const buf = Buffer.alloc(addr.size);
        addr.pack(buf, val);

        return buf;
    }

    scout (req, out) {
        return scout_test(this, req, out);
    }

    read_values (addresses, signal) {
        return read_test(this, addresses, signal);
    }
}

/* The same driver, but it answers that it can't scan or read.
 * bin/driver.js uses it when SCOUT_UNSUPPORTED is 1, so the Edge
 * Agent's tests can check the UNSUPPORTED and NOREADS answers against
 * a real driver. */
export class NoScoutTestHandler extends TestHandler {
    static scouts = false;
    static reads = false;
}
