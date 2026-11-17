/*
 * ACS Edge Agent
 * Split-driver cluster rig: run the mock devices of a rig
 * Copyright 2026 University of Sheffield
 *
 *   run-mocks --rig <rig.json[.gz]> --protocol <OPC UA|MQTT|REST|UDP>
 *       [--only <id,...>] [--advertise <host>] [--udp-target <host>]
 *       [--control-port <n>]
 *
 * Synthesises each connection's fixture from its config, starts one
 * mock per connection of the protocol, and serves a small control API
 * on the control port:
 *
 *   GET  /status            every mock's status as JSON
 *   POST /mocks/<id>/stop   stop one mock (its device goes offline)
 *   POST /mocks/<id>/start  start it again
 *   POST /stop, /start      all of them
 */

import http from "http";

import { MockOpts, make_mock } from "./mocks/index.js";
import type { Mock } from "./mocks/mock.js";
import { CONTROL_PORT, Protocol, PROTOCOLS, Rig, RigConnection, read_rig } from "./rig.js";

/* Serve the control API. Returns the server. */
export function control_server (mocks: Mock[], port: number): Promise<http.Server> {
    const by_id = new Map(mocks.map(m => [m.conn.id, m]));
    const srv = http.createServer(async (req, res) => {
        const reply = (st: number, body: any) => {
            res.writeHead(st, { "Content-Type": "application/json" });
            res.end(JSON.stringify(body, null, 1) + "\n");
        };
        try {
            const url = req.url ?? "";
            if (req.method == "GET" && url == "/status")
                return reply(200, mocks.map(m => m.status()));
            if (req.method != "POST") return reply(404, { error: "not found" });

            let m = url.match(/^\/mocks\/([^/]+)\/(stop|start)$/);
            const which = m ? [by_id.get(m[1])] : mocks;
            const action = m?.[2] ?? url.match(/^\/(stop|start)$/)?.[1];
            if (!action || which.some(x => !x))
                return reply(404, { error: "not found" });
            for (const x of which as Mock[]) {
                console.log("%s %s (%s)", action == "stop" ? "Stopping" : "Starting",
                    x.conn.id, x.conn.name);
                await (action == "stop" ? x.stop() : x.start());
            }
            reply(200, (which as Mock[]).map(x => x.status()));
        }
        catch (e: any) {
            reply(500, { error: String(e?.message ?? e) });
        }
    });
    return new Promise((resolve, reject) => {
        srv.once("error", reject);
        srv.listen(port, () => resolve(srv));
    });
}

/* Start every mock of `proto` in the rig, or those in `only`. */
export async function start_mocks (rig: Rig, proto: Protocol,
    opts: MockOpts & { only?: string[] } = {})
{
    const conns = rig.connections.filter(c => c.protocol == proto
        && (!opts.only || opts.only.includes(c.id)));
    const mocks: Mock[] = [];
    for (const c of conns) {
        const t0 = Date.now();
        const mock = make_mock(rig, c, opts);
        await mock.start();
        mocks.push(mock);
        console.log("Started %s on port %d for %s/%s (%d ms to synthesise and start)",
            c.id, c.port, c.node, c.name, Date.now() - t0);
    }
    return mocks;
}

function parse_args (argv: string[]) {
    const opts: { [k: string]: string } = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) throw new Error(`Unexpected argument ${a}`);
        opts[a.slice(2)] = argv[++i];
    }
    return opts;
}

async function main () {
    const args = parse_args(process.argv.slice(2));
    const proto = args.protocol as Protocol;
    if (!args.rig || !PROTOCOLS.includes(proto)) {
        console.error("Usage: run-mocks --rig <rig.json> --protocol <OPC UA|MQTT|REST|UDP> "
            + "[--only id,...] [--advertise host] [--udp-target host] [--control-port n]");
        process.exit(2);
    }
    const rig = read_rig(args.rig);
    const mocks = await start_mocks(rig, proto, {
        only:       args.only?.split(","),
        advertise:  args.advertise,
        udp_target: args["udp-target"],
    });
    if (!mocks.length) {
        console.error("No %s connections in this rig", proto);
        process.exit(1);
    }
    const port = Number(args["control-port"] ?? CONTROL_PORT);
    await control_server(mocks, port);
    console.log("%d %s mocks running; control API on port %d", mocks.length, proto, port);

    const shutdown = async () => {
        console.log("Stopping");
        await Promise.all(mocks.map(m => m.stop().catch(() => {})));
        process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}

if (process.argv[1]?.match(/run-mocks\.[jt]s$/))
    await main();
