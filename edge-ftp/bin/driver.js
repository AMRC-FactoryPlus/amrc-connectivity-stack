/*
 * ACS FTP driver
 * Entrypoint.
 * Copyright 2026 University of Sheffield AMRC
 */

import { PolledDriver } from "@amrc-factoryplus/edge-driver";

import { FTPHandler } from "../lib/handler.js";

/* Polled: a file server can't push changes, so the edge agent's poll
 * loop drives every read. Serial: one connection does one thing at a
 * time. */
const drv = new PolledDriver({
    env:        process.env,
    handler:    FTPHandler,
    serial:     true,
});
drv.run();
