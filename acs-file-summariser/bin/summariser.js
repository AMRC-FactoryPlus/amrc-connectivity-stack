#!/usr/bin/env node

/* ACS File Summariser
 * Main entry point
 * Copyright 2026 University of Sheffield
 */

import { RxClient } from "@amrc-factoryplus/rx-client";

import { Summarisers }  from "../lib/summarisers/index.js";
import { Dispatcher }   from "../lib/dispatcher.js";
import { Queue }        from "../lib/queue.js";
import { State }        from "../lib/state.js";
import { Influx }       from "../lib/influx.js";
import { Job }          from "../lib/job.js";

const { env } = process;

const fplus = await new RxClient({ env }).init();
const log = fplus.debug.bound("summariser");

const influx = await new Influx({
    log,
    url:            env.INFLUX_URL,
    org:            env.INFLUX_ORG,
    bucket:         env.INFLUX_BUCKET,
    token:          env.INFLUX_TOKEN,
    batch_size:     Number(env.BATCH_SIZE ?? 5000),
    flush_interval: Number(env.FLUSH_INTERVAL ?? 10000),
}).init();

const state = await new State({ fplus }).init();

const queue = await new Queue({
    log,
    concurrency: Number(env.MAX_CONCURRENT_JOBS ?? 1),
}).init();

const job = await new Job({
    fplus, state, influx,
    scratch_dir: env.SCRATCH_DIR ?? "/scratch",
}).init();

const dispatcher = await new Dispatcher({
    fplus, state, queue,
    registry: Summarisers,
    process: (file_uuid, plugin) => job.run(file_uuid, plugin),
}).init();

process.on("exit", () => influx.close());

log("Starting File Summariser");
dispatcher.run();
