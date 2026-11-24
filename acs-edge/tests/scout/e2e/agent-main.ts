/*
 * ACS Edge Agent
 * Edge Scout end-to-end tests: the Edge Agent's entry point
 * Copyright 2026 University of Sheffield
 *
 * This starts the agent as app.ts does: a ServiceClient from the
 * environment, a DriverBroker and a Translator. It leaves out the
 * version file the Docker build generates, and prints the process's
 * memory and CPU use every 250 ms on lines starting E2E-USAGE, so the
 * test can measure the agent alone.
 */

import { ServiceClient } from "@amrc-factoryplus/utilities";

import { DriverBroker } from "../../../lib/driverBroker.js";
import { Translator } from "../../../lib/translator.js";

function usage () {
    const m = process.memoryUsage();
    const r = process.resourceUsage();
    console.log("E2E-USAGE " + JSON.stringify({
        at:         Date.now(),
        rss:        m.rss,
        heap:       m.heapUsed,
        /* Peak resident set size, in KiB. */
        max_rss_kb: r.maxRSS,
        cpu_us:     r.userCPUTime + r.systemCPUTime,
    }));
}

async function main () {
    const fplus = await new ServiceClient({ env: process.env }).init();
    const broker = new DriverBroker(process.env);
    const translator = new Translator(fplus, parseInt(process.env.POLL_INT ?? "") || 30, broker);

    process.once("SIGTERM", async () => {
        await translator.stop(true);
        usage();
        process.exit(0);
    });
    setInterval(usage, 250).unref();

    await translator.start();
    console.log("E2E-STARTED");
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
