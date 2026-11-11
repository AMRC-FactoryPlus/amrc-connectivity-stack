/*
 * ACS Data Access Service
 * Benchmark: how long one change blocks the service, by open sessions
 * Copyright 2026 University of Sheffield
 */

/* A script to run by hand. `npm test` does not run it.
 *
 * It builds a fake site the size of a real one, opens one, two and
 * three sessions as an open Datasets page holds them, makes changes
 * one at a time and prints how long each kept the event loop busy.
 * The site is a fake ConfigDB and Auth in this process, so the times
 * are the work Data Access does and nothing else: no network, and no
 * ConfigDB or Auth of its own.
 *
 *   node tests/perf/bench.mjs
 *
 * To compare with the service as it was at another commit, put that
 * commit's lib/ where it finds the same node_modules, and name it.
 * From the acs-data-access directory (tmp/ is ignored by git):
 *
 *   mkdir -p tmp/before
 *   git archive <commit> lib | tar -x -C tmp/before
 *   node tests/perf/bench.mjs --before tmp/before/lib
 *
 * An older lib/ may import a package this one no longer lists. If it
 * does, install it without saving it: npm install --no-save <name>.
 *
 * Options:
 *
 *   --before DIR    A second lib/ to measure first, for a comparison.
 *   --lib DIR       The lib/ to measure. The default is this one.
 *   --datasets N    Datasets on the site when measuring. Default 713.
 *   --sessions A,B  The session counts to measure. Default 1,2,3.
 *   --changes N     How many times to make each change. Default 5.
 *   --lists         Each session also holds the four list WATCHes.
 *
 * It needs Node 20 or later. */

import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as rx from "rxjs";

import { UUIDs } from "@amrc-factoryplus/rx-client";
import { json_equal } from "@amrc-factoryplus/service-api";

import { DataAccess as Constants } from "../../lib/constants.js";
import { default_dataset_uuid } from "../../lib/default-datasets.js";
import { ROOT, make_site } from "../support/fake-site.js";
import { build_site } from "../support/site-builder.js";

const { App, Perm } = Constants;
const { Info } = UUIDs.App;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const debug = { bound: () => () => {} };

/* The site this was first measured on: 713 datasets, of which 581 are
 * default datasets, 587 devices and 1,636 General information
 * entries. Other sizes keep the same proportions. */
const REAL = { datasets: 713, defaults: 581, devices: 587, infos: 1636 };

function options (argv) {
    const opts = {
        before: null, lib: path.join(HERE, "../../lib"),
        datasets: REAL.datasets, sessions: [1, 2, 3], changes: 5, lists: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const value = () => {
            if (i + 1 >= argv.length)
                throw new Error(`${argv[i]} needs a value`);
            return argv[++i];
        };
        switch (argv[i]) {
            case "--before":    opts.before = path.resolve(value()); break;
            case "--lib":       opts.lib = path.resolve(value()); break;
            case "--datasets":  opts.datasets = Number(value()); break;
            case "--changes":   opts.changes = Number(value()); break;
            case "--sessions":  opts.sessions = value().split(",").map(Number); break;
            case "--lists":     opts.lists = true; break;
            default:
                throw new Error(`Unknown option ${argv[i]}`);
        }
    }
    const whole = n => Number.isInteger(n) && n > 0;
    if (!whole(opts.datasets) || !whole(opts.changes) || !opts.sessions.every(whole))
        throw new Error("--datasets, --changes and --sessions take whole numbers above 0");
    if (opts.datasets < 100 + opts.changes)
        throw new Error("--datasets is too small to build a site from");
    return opts;
}

/* The three classes this drives, from one lib/ directory. */
async function load (dir) {
    const from = file => import(pathToFileURL(path.join(dir, file)).href);
    const [{ DataFlow }, { DataAccessNotify }, { DefaultDatasets }] =
        await Promise.all([
            from("dataflow.js"), from("notify.js"), from("default-datasets.js"),
        ]);
    return { DataFlow, DataAccessNotify, DefaultDatasets };
}

/* The subscriptions one session holds. An open Datasets page holds
 * the two searches. */
function subscriptions (lists) {
    const subs = [
        { method: "SEARCH", parent: "v2/metadata/" },
        { method: "SEARCH", parent: "v2/structure/" },
    ];
    if (lists) {
        for (const url of ["v2/metadata/", "v2/structure/",
                "v2/union-sources/", "v2/session-sources/"])
            subs.push({ method: "WATCH", request: { url } });
    }
    return subs;
}

/* A principal for each session. All of them see every dataset: root,
 * then principals with a grant on every target. */
function principals (site, count) {
    const out = [ROOT];
    for (let i = 1; i < count; i++) {
        const principal = `admin${i}@EXAMPLE.ORG`;
        site.set_acl(principal, [
            Perm.ReadDataset, Perm.EditDataset, Perm.IncludeInUnion, Perm.UseForSession,
        ].map(permission => ({ permission, target: UUIDs.Special.Null })));
        out.push(principal);
    }
    return out;
}

/* A site of `opts.datasets` datasets once `opts.changes` more default
 * datasets have been made, with the service from `lib` running over
 * it. `open_sessions` opens `sessions` sessions. */
function fixture (lib, opts, sessions) {
    const scale = opts.datasets / REAL.datasets;
    const datasets = opts.datasets - opts.changes;
    const defaults = Math.round(REAL.defaults * scale) - opts.changes;
    const placed = defaults + opts.changes;

    const site = make_site();
    const built = build_site(site, {
        datasets, defaults, placed,
        devices:    placed + (REAL.devices - REAL.defaults),
        infos:      Math.round(REAL.infos * scale),
        seed:       713,
    });

    const data = new lib.DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    /* Older code builds its streams when they are first read. */
    data.run?.();

    const server = http.createServer();
    const dan = new lib.DataAccessNotify({
        api: { http: server, auth: { auth_bearer: async () => null } },
        data, debug, auth: site.auth,
    });
    const maker = new lib.DefaultDatasets({ data, cdb: site.cdb, debug });

    /* `searches` holds the messages each open SEARCH has had, as
     * `{ parent, messages }`. */
    const seen = { messages: 0, bytes: 0, ended: [], searches: [] };
    const open = [];
    const who = principals(site, sessions);
    const open_sessions = () => {
        for (const principal of who) {
            for (const sub of subscriptions(opts.lists)) {
                const search = sub.method == "SEARCH"
                    ? { parent: sub.parent, messages: 0 } : null;
                if (search) seen.searches.push(search);
                /* What a notify session does with a subscription:
                 * drop a message equal to the one before, turn an
                 * error into a 500, stop after a status of 400 or
                 * more, and write each message as JSON. */
                open.push(dan.notify.find_handler({ principal }, sub).pipe(
                    rx.distinctUntilChanged(json_equal),
                    rx.catchError(e => {
                        seen.ended.push(
                            `${sub.method} ${sub.parent ?? sub.request.url}: ${e}`);
                        return rx.of({ status: 500 });
                    }),
                    rx.takeWhile(res => res.status < 400, true),
                ).subscribe(message => {
                    seen.messages++;
                    if (search) search.messages++;
                    seen.bytes += JSON.stringify(message).length;
                    site.activity++;
                }));
            }
        }
    };

    const close = () => {
        for (const sub of open) sub.unsubscribe();
        data.stop?.();
        site.close();
    };
    return { site, built, maker, seen, open_sessions, close };
}

/* Older code sends a long run of messages after a snapshot, so give
 * it many turns of the event loop to go quiet. */
const settle = site => site.settle({ turns: 100000, timeout: 600000 });

/* Make one change and measure it: the time every notification of the
 * change took to deliver, the longest of them, the time until the
 * service was idle again, the messages the sessions got, and how many
 * of the searches in `shows` got none. Every session sees every
 * dataset, so a search in `shows` that gets no message for the change
 * has stopped delivering. */
async function measure (fx, change, shows) {
    const { site, seen } = fx;
    await settle(site);
    site.reset_counters();
    const messages = seen.messages;
    const watched = seen.searches.filter(s => shows.includes(s.parent));
    const had = watched.map(s => s.messages);

    const start = performance.now();
    await change();
    await settle(site);
    const wall = performance.now() - start;

    const { blocks } = site.counters;
    return {
        blocked:    blocks.total,
        longest:    blocks.max,
        wall,
        messages:   seen.messages - messages,
        quiet:      watched.filter((s, i) => s.messages == had[i]).length,
        watched:    watched.length,
    };
}

const BOTH = ["v2/metadata/", "v2/structure/"];

/* The changes measured. `make` takes the fixture and how many times
 * the change has run, and returns a function that makes it once.
 * `shows` names the searches that must send a message for it. */
const CHANGES = [
    {
        name: "Make one default dataset",
        shows: BOTH,
        make (fx, i) {
            const device = fx.built.spare_devices[i];
            return () => fx.maker.make(device, default_dataset_uuid(device));
        },
    },
    {
        name: "Rename one dataset",
        shows: ["v2/metadata/"],
        make (fx, i) {
            const { dataset } = fx.built.defaults[i];
            return () => fx.site.put(Info, dataset, { name: `Renamed ${i}` });
        },
    },
    {
        name: "Name an object that is not a dataset",
        shows: [],
        make (fx, i) {
            return () => fx.site.put(Info, fx.built.spare(i), { name: `Other ${i}` });
        },
    },
    {
        name: "Edit one session's window",
        shows: BOTH,
        make (fx, i) {
            const session = fx.built.kinds.sessions[i];
            const config = fx.site.app(App.SessionLimits).get(session);
            return () => fx.site.put(App.SessionLimits, session,
                { ...config, to: `2031-01-0${1 + i % 9}T00:00:00.000Z` });
        },
    },
];

const median = list => {
    const s = [...list].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/* Measure every change at every session count, for one lib/. */
async function run (dir, opts) {
    const lib = await load(dir);
    const rows = [];
    for (const sessions of opts.sessions) {
        const fx = fixture(lib, opts, sessions);
        try {
            await settle(fx.site);
            const start = performance.now();
            fx.open_sessions();
            await settle(fx.site);
            const opening = performance.now() - start;
            const snapshot = fx.seen.messages;

            for (const change of CHANGES) {
                const runs = [];
                for (let i = 0; i < opts.changes; i++)
                    runs.push(await measure(fx, change.make(fx, i), change.shows));
                const quiet = Math.max(...runs.map(r => r.quiet));
                rows.push({
                    sessions, change: change.name,
                    blocked:    median(runs.map(r => r.blocked)),
                    longest:    Math.max(...runs.map(r => r.longest)),
                    wall:       median(runs.map(r => r.wall)),
                    messages:   median(runs.map(r => r.messages)),
                    quiet:      runs[0].watched ? `${quiet} of ${runs[0].watched}` : "",
                });
            }
            rows.push({
                sessions, change: "(open the sessions)", note: true,
                blocked: null, longest: null, wall: opening, messages: snapshot,
            });
            for (const ended of new Set(fx.seen.ended))
                rows.push({ sessions, change: `(a subscription ended: ${ended})`, note: true });
        }
        finally {
            fx.close();
        }
    }
    return rows;
}

const ms = n => n == null ? "" : n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2);

function table (head, rows) {
    const lines = [head, head.map(() => "---"), ...rows];
    return lines.map(cells => `| ${cells.join(" | ")} |`).join("\n");
}

function print_one (title, rows) {
    console.log(`\n### ${title}\n`);
    console.log(table(
        ["Sessions", "Change", "Blocked (ms)", "Longest block (ms)",
            "Until idle (ms)", "Messages", "Searches that sent nothing"],
        rows.map(r => [r.sessions, r.change, ms(r.blocked), ms(r.longest),
            ms(r.wall), r.messages ?? "", r.quiet ?? ""])));
}

function print_both (before, after) {
    const key = r => `${r.sessions} ${r.change}`;
    const then = new Map(before.filter(r => !r.note).map(r => [key(r), r]));
    console.log("\n### Before and after\n");
    console.log(table(
        ["Sessions", "Change", "Blocked before (ms)", "Blocked after (ms)",
            "Times less"],
        after.filter(r => !r.note).map(r => {
            const b = then.get(key(r));
            const ratio = b && r.blocked > 0 ? (b.blocked / r.blocked).toFixed(0) : "";
            return [r.sessions, r.change, ms(b?.blocked), ms(r.blocked), ratio];
        })));
}

async function main () {
    const opts = options(process.argv.slice(2));
    console.log(`Data Access benchmark: ${opts.datasets} datasets, `
        + `each change made ${opts.changes} times, Node ${process.version}`);
    console.log("A session holds the two searches"
        + (opts.lists ? " and the four lists." : "."));
    console.log("Blocked is the time the event loop was busy delivering the "
        + "change's notifications: the median over the changes made. "
        + "Longest block is the slowest single notification. "
        + "Every session sees every dataset, so a search that sent nothing "
        + "for a change it shows has stopped delivering.");

    const before = opts.before ? await run(opts.before, opts) : null;
    if (before) print_one("Before", before);
    const after = await run(opts.lib, opts);
    print_one(before ? "After" : "Results", after);
    if (before) print_both(before, after);
}

main().then(
    () => process.exit(0),
    err => {
        console.error(err);
        process.exit(1);
    });
