/*
 * Factory+ Service HTTP API
 * notify/v2: the send buffer limit setting.
 * Copyright 2026 University of Sheffield AMRC
 */

import test from "node:test";
import assert from "node:assert/strict";

import { Notify } from "../lib/notify-v2.js";

const MiB8 = 8 * 1024 * 1024;

function notify (opts, env) {
    const saved = process.env.NOTIFY_MAX_BUFFER;
    if (env === undefined) delete process.env.NOTIFY_MAX_BUFFER;
    else process.env.NOTIFY_MAX_BUFFER = env;
    const logs = [];
    try {
        const n = new Notify({ api: {}, log: (...a) => logs.push(a), ...opts });
        return [n.max_buffer, logs];
    }
    finally {
        if (saved === undefined) delete process.env.NOTIFY_MAX_BUFFER;
        else process.env.NOTIFY_MAX_BUFFER = saved;
    }
}

test("max_buffer: default, option and environment", () => {
    assert.deepEqual(notify({}), [MiB8, []]);
    assert.deepEqual(notify({ max_buffer: 1000 }), [1000, []]);
    assert.deepEqual(notify({}, "65536"), [65536, []]);
    assert.deepEqual(notify({ max_buffer: 1000 }, "65536"), [1000, []]);
});

test("max_buffer: a bad option falls back to 8 MiB", () => {
    for (const bad of [0, -1, 1.5, "1000"]) {
        const [mb, logs] = notify({ max_buffer: bad });
        assert.equal(mb, MiB8, `option ${bad}`);
        assert.equal(logs.length, 1);
    }
});

test("max_buffer: a bad NOTIFY_MAX_BUFFER falls back to 8 MiB and is logged once", () => {
    for (const bad of ["8M", "0", "-5", "1e6", "abc", "8 MiB"]) {
        const [mb, logs] = notify({}, bad);
        assert.equal(mb, MiB8, `env ${bad}`);
        assert.equal(logs.length, 1, `env ${bad}`);
        assert.match(logs[0][0], /NOTIFY_MAX_BUFFER/);
    }
});
