/*
 * ACS Data Access Service
 * The default dataset maker under a burst: one pass, a few at a time
 * Copyright 2026 University of Sheffield
 */

/* What the maker does when many devices need a dataset at once, when
 * ConfigDB is slow, when an input fails in the middle of a pass and
 * when it is stopped. Each test runs the real class against a fake
 * site, on fake timers, and counts the ConfigDB calls.
 *
 * They run against fakes, so they need no cluster. */

import { Map as IMap } from "immutable";
import * as rx from "rxjs";
import { v5 as uuidv5 } from "uuid";
import { afterEach, describe, expect, test, vi } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { DefaultDatasets, default_dataset_uuid } from "../../lib/default-datasets.js";
import { make_site } from "../support/fake-site.js";
import { build_site } from "../support/site-builder.js";

const { App } = Constants;
const { Info } = UUIDs.App;
const Placement = Constants.External.ISA95Placement;

const debug = { bound: () => () => {} };

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/* The maker's own defaults, written out so a test can say why its
 * timings are what they are. */
const DEBOUNCE = 2 * SECOND;
const SETTLE = 60 * SECOND;
const RETRY_INTERVAL = 5 * MINUTE;
/* The delay before a failed input is subscribed again. */
const RETRY_DELAY = 5 * SECOND;
/* The ConfigDB calls one dataset takes when its device has a name:
 * the object, the UNS device entry, two reads and the name. */
const CALLS_PER_MAKE = 5;

const cleanup = [];

afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
    vi.useRealTimers();
});

const advance = ms => vi.advanceTimersByTimeAsync(ms);

/* A ConfigDB interface that records the calls made through it. Only
 * the maker gets it, so the log holds the maker's calls and no others. */
function logged (cdb) {
    const log = {
        calls: [],
        in_flight: 0,
        most_in_flight: 0,
        of (method) { return this.calls.filter(c => c.method == method); },
        /* The objects created, in the order asked for. */
        creates () { return this.of("create_object").map(c => c.args[1]); },
        /* The UNS device entries written. */
        uns_puts () {
            return this.of("put_config")
                .filter(c => c.args[0] == App.UNSDevice).map(c => c.args[1]);
        },
        /* Every object a call named. */
        objects () { return new Set(this.calls.map(c => c.args[1])); },
    };
    const wrap = method => async (...args) => {
        const call = { method, args, start: Date.now(), end: null };
        log.calls.push(call);
        log.in_flight++;
        log.most_in_flight = Math.max(log.most_in_flight, log.in_flight);
        try {
            return await cdb[method](...args);
        }
        finally {
            log.in_flight--;
            call.end = Date.now();
        }
    };
    return {
        log,
        cdb: {
            ...cdb,
            create_object:  wrap("create_object"),
            put_config:     wrap("put_config"),
            get_config:     wrap("get_config"),
        },
    };
}

/* Count what a maker does, from the outside: how many of each step
 * run at once, and when each pass starts and ends. Call this before
 * run(). */
function probe (maker) {
    const seen = {
        /* Lists `jobs` and `renames` gave: each asks for a pass. */
        triggers: 0, rename_triggers: 0,
        makes: 0, in_flight: 0, most_in_flight: 0,
        passes: [], running: 0, most_running: 0,
        drains: [], draining: 0, most_draining: 0,
        rename_passes: [], renaming: 0, most_renaming: 0,
        rename_drains: [], rename_draining: 0, most_rename_draining: 0,
    };

    const jobs = maker.jobs.bind(maker);
    maker.jobs = () => jobs().pipe(rx.tap(() => seen.triggers++));
    const renames = maker.renames.bind(maker);
    maker.renames = () => renames().pipe(rx.tap(() => seen.rename_triggers++));

    const make = maker.make.bind(maker);
    maker.make = async (...args) => {
        seen.makes++;
        seen.in_flight++;
        seen.most_in_flight = Math.max(seen.most_in_flight, seen.in_flight);
        try {
            return await make(...args);
        }
        finally {
            seen.in_flight--;
        }
    };

    /* Record one call of a pass or a drain. */
    const timed = (fn, list, count, most) => async (...args) => {
        const given = Array.isArray(args[0]) ? args[0] : null;
        const rec = {
            start: Date.now(), end: null,
            /* What a pass was given, in the order it works through. */
            list: given, items: given?.length ?? null,
            result: null,
        };
        list.push(rec);
        seen[count]++;
        seen[most] = Math.max(seen[most], seen[count]);
        try {
            return rec.result = await fn(...args);
        }
        finally {
            seen[count]--;
            rec.end = Date.now();
        }
    };

    maker.make_all = timed(maker.make_all.bind(maker),
        seen.passes, "running", "most_running");
    maker.rename_all = timed(maker.rename_all.bind(maker),
        seen.rename_passes, "renaming", "most_renaming");
    maker.drain = timed(maker.drain.bind(maker),
        seen.drains, "draining", "most_draining");
    maker.rename_drain = timed(maker.rename_drain.bind(maker),
        seen.rename_drains, "rename_draining", "most_rename_draining");

    return seen;
}

/* A source a test can change and fail. Each subscribe gets the newest
 * value. After fail(), the open subscription has errored and the next
 * subscribe gets a working source again. */
function restartable (value) {
    let subject = new rx.BehaviorSubject(value);
    const state = {
        subscribes: 0,
        source: rx.defer(() => {
            state.subscribes++;
            return subject;
        }),
        next (v) {
            value = v;
            subject.next(v);
        },
        fail (err = new Error("The source failed")) {
            const old = subject;
            subject = new rx.BehaviorSubject(value);
            old.error(err);
        },
        close () { subject.complete(); },
    };
    return state;
}

/* A site of `n` placed devices with no default dataset, and the real
 * maker over it. Installs fake timers.
 * @arg opts.site Options for the fake site (latency, notify_lag).
 * @arg opts.maker Options for the maker.
 * @arg opts.devices How many devices in all; those past `n` have no
 * placement.
 * @arg opts.data A stand-in for the DataFlow. The default is the real
 * one over the fake site.
 * @arg opts.names False to switch off the half of the maker that keeps
 * names right, for a test that counts every call. It reads and writes
 * names beside the pass, as it always has.
 */
function rig (n, opts = {}) {
    vi.useFakeTimers();
    const site = make_site(opts.site);
    const built = build_site(site, {
        datasets: 0, devices: opts.devices ?? n, placed: n, seed: opts.seed ?? 31 });
    const data = opts.data
        ?? new DataFlow({ debug, cdb: site.cdb, auth: site.auth });
    data.run?.();

    const { cdb, log } = logged(site.cdb);
    const maker = new DefaultDatasets({ data, cdb, debug, ...opts.maker });
    const seen = probe(maker);
    if (opts.names === false) maker.renames = () => rx.NEVER;
    cleanup.push(() => {
        maker.stop();
        data.stop?.();
        site.close();
    });

    const missing = built.placed.map(device =>
        ({ device, dataset: default_dataset_uuid(device) }));
    return { site, built, data, maker, seen, log, missing };
}

/* The placements of a built site, as the maker's input gives them. */
const placements_of = built =>
    new Map(built.placed.map(device => [device, { node: built.node }]));

/* Every placed device has its dataset, named after the device. */
function expect_all_made (fx) {
    const uns = fx.site.app(App.UNSDevice);
    const infos = fx.site.app(Info);
    for (const { device, dataset } of fx.missing) {
        expect(uns.get(dataset)).toEqual({ source: device });
        expect(infos.get(dataset)?.name).toBe(infos.get(device).name);
        expect(fx.site.members(Constants.Class.Dataset).has(dataset)).toBe(true);
    }
}

/* Each item of `list` once, and nothing else. */
function expect_each_once (actual, list) {
    expect(actual).toHaveLength(list.length);
    expect(new Set(actual)).toEqual(new Set(list));
}

describe("the timings these tests assume", () => {
    /* The constants above are copies. Each test that compares a
     * latency or a lag with one of them proves its premise only while
     * the copy is what the maker uses. */
    test("are the maker's own defaults", () => {
        const maker = new DefaultDatasets({
            debug, data: {}, cdb: {}, placements: rx.NEVER, devices: rx.NEVER });

        expect(maker.debounce).toBe(DEBOUNCE);
        expect(maker.settle).toBe(SETTLE);
        expect(maker.retry_interval).toBe(RETRY_INTERVAL);
        expect(maker.retry_delay).toBe(RETRY_DELAY);
        expect(maker.concurrency).toBe(4);
    });

    /* What the delay does shows only in when the maker subscribes
     * again. */
    test("include the delay before a failed input is subscribed again", async () => {
        const fx = rig(2, { site: { latency: 100 } });
        const placements = restartable(placements_of(fx.built));
        fx.maker.placements = placements.source;
        cleanup.push(() => placements.close());

        fx.maker.run();
        await advance(SECOND);
        placements.fail();
        await advance(RETRY_DELAY - 100);
        expect(placements.subscribes).toBe(1);
        await advance(200);
        expect(placements.subscribes).toBe(2);
    });
});

describe("a burst of placed devices", () => {
    test("40 devices, slow calls and a pass longer than the settle time: 40 creates", async () => {
        /* Each call outlasts the debounce, so `jobs` gives a new list
         * of missing datasets many times during the pass. The dataset
         * map trails each write by 10 s, so when the pass ends the map
         * does not show the last batch yet. */
        const latency = 2500;
        const fx = rig(40, { site: { latency, notify_lag: 10 * SECOND } });
        expect(latency).toBeGreaterThan(DEBOUNCE);

        fx.maker.run();
        await advance(10 * MINUTE);
        await fx.site.settle();

        /* The first pass made everything, and outlasted the settle
         * time: its first datasets were old enough to make again when
         * it ended. */
        const [first, second] = fx.seen.passes;
        expect(first.items).toBe(40);
        expect(first.result).toBe(40);
        expect(first.end - first.start).toBeGreaterThan(SETTLE);
        expect(fx.seen.triggers).toBeGreaterThan(2);
        /* The lists that arrived during it gave one further pass,
         * straight after it. The map still showed the last batch as
         * missing, and the pass left those datasets alone: they had
         * just been made, although the pass that made them started
         * more than the settle time before. */
        expect(second.start).toBe(first.end);
        expect(second.items).toBe(4);
        expect(second.result).toBe(0);
        expect(fx.seen.most_running).toBe(1);

        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
        expect_each_once(fx.log.uns_puts(), fx.missing.map(m => m.dataset));
        expect(fx.site.counters.calls.get("create_object")).toBe(40);
        expect(fx.seen.makes).toBe(40);
        expect_all_made(fx);

        const datasets = await rx.firstValueFrom(fx.data.datasets);
        for (const { dataset } of fx.missing)
            expect(datasets.has(dataset)).toBe(true);
    });

    test("581 devices: 581 creates", async () => {
        /* A batch of four ends every 3 s, so the debounce gives a new
         * list after every batch, and the pass lasts seven minutes. */
        const fx = rig(581, { site: { latency: 600, notify_lag: 50 } });

        fx.maker.run();
        await advance(20 * MINUTE);
        await fx.site.settle();

        const [first] = fx.seen.passes;
        expect(first.items).toBe(581);
        expect(first.end - first.start).toBeGreaterThan(SETTLE);
        expect(fx.seen.triggers).toBeGreaterThan(100);

        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
        expect_each_once(fx.log.uns_puts(), fx.missing.map(m => m.dataset));
        expect(fx.site.counters.calls.get("create_object")).toBe(581);
        expect(fx.seen.most_in_flight).toBe(4);
        expect(fx.seen.most_running).toBe(1);
        expect_all_made(fx);
    }, 120 * SECOND);

    test("four datasets are made at a time, in one pass, with one more pass waiting", async () => {
        const fx = rig(12, { site: { latency: 1000 } });

        fx.maker.run();
        await advance(2 * MINUTE);
        await fx.site.settle();

        expect(fx.maker.concurrency).toBe(4);
        expect(fx.seen.most_in_flight).toBe(4);

        /* The first list starts the pass. The lists after the first
         * and second batch arrive while it runs, and together they
         * cause one further pass, which finds nothing to do. */
        expect(fx.seen.triggers).toBe(3);
        expect(fx.seen.drains).toHaveLength(2);
        expect(fx.seen.most_draining).toBe(1);
        expect(fx.seen.most_running).toBe(1);
        expect(fx.seen.passes.map(p => p.items)).toEqual([12, 0]);
        expect(fx.seen.passes[1].start)
            .toBeGreaterThanOrEqual(fx.seen.passes[0].end);

        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
        expect_all_made(fx);
    });

    test("with concurrency 1 the writes are strictly sequential", async () => {
        const fx = rig(6, {
            site: { latency: 1000 }, maker: { concurrency: 1 }, names: false });

        fx.maker.run();
        await advance(2 * MINUTE);
        await fx.site.settle();

        expect(fx.seen.most_in_flight).toBe(1);
        expect(fx.log.most_in_flight).toBe(1);
        /* Datasets in the order listed, and each one finished before
         * the next is started. */
        expect(fx.log.creates())
            .toEqual(fx.seen.passes[0].list.map(m => m.dataset));
        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
        const { calls } = fx.log;
        expect(calls).toHaveLength(6 * CALLS_PER_MAKE);
        for (let i = 1; i < calls.length; i++)
            expect(calls[i].start).toBeGreaterThanOrEqual(calls[i - 1].end);
        for (let i = 0; i < calls.length; i += CALLS_PER_MAKE)
            expect(calls.slice(i, i + CALLS_PER_MAKE).map(c => c.method)).toEqual([
                "create_object", "put_config", "get_config", "get_config", "put_config"]);
        expect_all_made(fx);
    });

    test("a concurrency above the number of datasets makes them all at once", async () => {
        const fx = rig(3, { site: { latency: 1000 }, maker: { concurrency: 10 } });

        fx.maker.run();
        await advance(MINUTE);
        await fx.site.settle();

        expect(fx.seen.most_in_flight).toBe(3);
        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
    });
});

describe("an input error", () => {
    test("in the middle of a pass: no second pass beside it, and no dataset made twice", async () => {
        const latency = 2500;
        const fx = rig(12, { site: { latency } });
        const placements = restartable(placements_of(fx.built));
        fx.maker.placements = placements.source;
        cleanup.push(() => placements.close());

        /* Three batches of four: the pass outlasts the retry delay
         * and the debounce together, so the retried subscription asks
         * for a pass while the first still runs. */
        const pass_time = 3 * CALLS_PER_MAKE * latency;
        expect(pass_time).toBeGreaterThan(2 * (RETRY_DELAY + DEBOUNCE));

        fx.maker.run();
        await advance(DEBOUNCE + 8 * SECOND);
        expect(fx.seen.running).toBe(1);
        expect(placements.subscribes).toBe(1);

        placements.fail();
        await advance(RETRY_DELAY + DEBOUNCE + SECOND);

        /* The maker has subscribed again and asked for a pass. The
         * first pass still runs, and it runs alone. */
        expect(placements.subscribes).toBe(2);
        expect(fx.seen.drains).toHaveLength(2);
        expect(fx.seen.drains[1].end).toBe(null);
        expect(fx.seen.passes).toHaveLength(1);
        expect(fx.seen.running).toBe(1);

        await advance(5 * MINUTE - 1);
        await fx.site.settle();

        expect(fx.seen.most_running).toBe(1);
        expect(fx.seen.most_in_flight).toBe(4);
        expect(fx.seen.passes.length).toBeGreaterThanOrEqual(2);
        const [first, second] = fx.seen.passes;
        expect(first.result).toBe(12);
        expect(second.start).toBeGreaterThanOrEqual(first.end);
        /* The pass was asked for before the first one ended. */
        expect(fx.seen.drains[1].start).toBeLessThan(first.end);

        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
        expect(fx.site.counters.calls.get("create_object")).toBe(12);
        expect_all_made(fx);
    });

    test("does not stop the maker: a device placed after the error gets its dataset", async () => {
        const fx = rig(3, { devices: 4, site: { latency: 100 } });
        const placements = restartable(placements_of(fx.built));
        fx.maker.placements = placements.source;
        cleanup.push(() => placements.close());

        fx.maker.run();
        await advance(10 * SECOND);
        expect(fx.log.creates()).toHaveLength(3);

        placements.fail();
        await advance(RETRY_DELAY + SECOND);
        expect(placements.subscribes).toBe(2);

        const [late] = fx.built.unplaced;
        placements.next(new Map([
            ...placements_of(fx.built), [late, { node: fx.built.node }]]));
        await advance(10 * SECOND);
        await fx.site.settle();

        expect_each_once(fx.log.creates(),
            [...fx.missing.map(m => m.dataset), default_dataset_uuid(late)]);
        expect(fx.site.app(App.UNSDevice).get(default_dataset_uuid(late)))
            .toEqual({ source: late });
    });

    test("is retried again and again, later each time", async () => {
        const fx = rig(2, { site: { latency: 100 } });
        const placements = restartable(placements_of(fx.built));
        fx.maker.placements = placements.source;
        cleanup.push(() => placements.close());

        fx.maker.run();
        await advance(SECOND);
        placements.fail();
        await advance(RETRY_DELAY + 500);
        expect(placements.subscribes).toBe(2);
        /* Failed again before it gave a list: the next try waits twice
         * as long. */
        placements.fail();
        await advance(RETRY_DELAY + 500);
        expect(placements.subscribes).toBe(2);
        await advance(RETRY_DELAY);
        expect(placements.subscribes).toBe(3);

        await advance(10 * SECOND);
        await fx.site.settle();
        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
    });

    /* The delay doubles for errors in a row. An error that comes
     * after the inputs have answered and stayed up is a new one: a
     * site that has had a handful of ConfigDB errors over some days
     * must not make a newly placed device wait minutes for its
     * dataset. Every dataset is made before the first error here, so
     * no list and no pass follows a retry: only the inputs show that
     * the retry worked. */
    test("after the inputs have answered again is retried at the first delay, every time", async () => {
        const fx = rig(2, { site: { latency: 100 } });
        const placements = restartable(placements_of(fx.built));
        fx.maker.placements = placements.source;
        cleanup.push(() => placements.close());

        fx.maker.run();
        await advance(10 * SECOND);
        await fx.site.settle();
        expect(fx.log.creates()).toHaveLength(2);

        for (let errors = 1; errors <= 5; errors++) {
            placements.fail();
            await advance(RETRY_DELAY - 100);
            expect(placements.subscribes).toBe(errors);
            await advance(200);
            expect(placements.subscribes).toBe(errors + 1);
            /* The inputs answer, and nothing is missing. */
            await advance(MINUTE);
        }
        expect(fx.seen.triggers).toBe(1);
        expect(fx.log.creates()).toHaveLength(2);
    });

    test("after an input that answered for less than the debounce is still retried later", async () => {
        const fx = rig(2, { site: { latency: 100 } });
        const placements = restartable(placements_of(fx.built));
        fx.maker.placements = placements.source;
        cleanup.push(() => placements.close());

        fx.maker.run();
        await advance(10 * SECOND);
        await fx.site.settle();

        /* Each retry gets an answer and loses it half a second
         * later, so the waits are 5, 10 and 20 s. */
        let waited = RETRY_DELAY;
        for (let errors = 1; errors <= 3; errors++) {
            placements.fail();
            await advance(waited - 100);
            expect(placements.subscribes).toBe(errors);
            await advance(200);
            expect(placements.subscribes).toBe(errors + 1);
            await advance(DEBOUNCE - 600);
            waited *= 2;
        }
    });

    test("on every try is retried after 5, 10, 20 ... 320 s, then at the first delay once the inputs answer", async () => {
        const fx = rig(2, { site: { latency: 100 } });
        /* The first nine subscriptions fail at once. Those after
         * them answer, and the test can fail them. */
        const working = restartable(placements_of(fx.built));
        cleanup.push(() => working.close());
        const tries = [];
        fx.maker.placements = rx.defer(() => {
            tries.push(Date.now());
            return tries.length <= 9
                ? rx.throwError(() => new Error("The source failed"))
                : working.source;
        });

        fx.maker.run();
        await advance(30 * MINUTE);
        await fx.site.settle();

        expect(tries).toHaveLength(10);
        expect(tries.slice(1).map((t, i) => (t - tries[i]) / SECOND))
            .toEqual([5, 10, 20, 40, 80, 160, 320, 320, 320]);
        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));

        working.fail();
        await advance(RETRY_DELAY - 100);
        expect(tries).toHaveLength(10);
        await advance(200);
        expect(tries).toHaveLength(11);
    });

    test("is retried at the first delay by a maker that was stopped and run again", async () => {
        const fx = rig(2, { site: { latency: 100 } });
        const tries = [];
        fx.maker.placements = rx.defer(() => {
            tries.push(Date.now());
            return rx.throwError(() => new Error("The source failed"));
        });

        fx.maker.run();
        await advance(MINUTE);
        /* Tries at 0, 5, 15 and 35 s: the next would wait 40 s. */
        expect(tries).toHaveLength(4);

        fx.maker.stop();
        fx.maker.run();
        expect(tries).toHaveLength(5);
        await advance(RETRY_DELAY - 100);
        expect(tries).toHaveLength(5);
        await advance(200);
        expect(tries).toHaveLength(6);
    });
});

describe("stop", () => {
    test("in the middle of a pass: what is in flight finishes, and nothing else is started", async () => {
        const fx = rig(12, { site: { latency: 1000 } });

        fx.maker.run();
        /* The first four are on their second call. */
        await advance(DEBOUNCE + 1500);
        expect(fx.seen.in_flight).toBe(4);
        const started = fx.seen.passes[0].list.slice(0, 4);
        expect(fx.log.creates()).toEqual(started.map(m => m.dataset));
        expect(fx.log.calls).toHaveLength(8);

        fx.maker.stop();
        await advance(10 * MINUTE);
        await fx.site.settle();

        /* The four in flight are whole. */
        expect(fx.seen.in_flight).toBe(0);
        expect(fx.log.uns_puts()).toEqual(started.map(m => m.dataset));
        for (const { device, dataset } of started) {
            expect(fx.site.app(App.UNSDevice).get(dataset)).toEqual({ source: device });
            expect(fx.site.app(Info).get(dataset)?.name)
                .toBe(fx.site.app(Info).get(device).name);
        }
        /* No call named any other dataset or device. */
        expect(fx.log.objects()).toEqual(
            new Set(started.flatMap(m => [m.device, m.dataset])));
        expect(fx.log.creates()).toHaveLength(4);
        expect(fx.seen.makes).toBe(4);
        expect(fx.seen.passes).toHaveLength(1);

        /* run() after stop() makes the rest, and only the rest. */
        fx.maker.run();
        await advance(10 * MINUTE);
        await fx.site.settle();

        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
        expect(fx.seen.most_running).toBe(1);
        expect_all_made(fx);
    });

    test("and at once run, in the middle of a pass: the old pass starts nothing more, and the new one waits for it", async () => {
        const fx = rig(12, { site: { latency: 1000 } });

        fx.maker.run();
        /* The first four are on their second call. */
        await advance(DEBOUNCE + 1500);
        expect(fx.seen.in_flight).toBe(4);
        const [old] = fx.seen.passes;
        const started = old.list.slice(0, 4);

        fx.maker.stop();
        fx.maker.run();
        /* The new run has asked for a pass. The old pass still has
         * its four datasets in flight, and it runs alone. */
        await advance(DEBOUNCE + 500);
        expect(fx.seen.drains).toHaveLength(2);
        expect(fx.seen.passes).toHaveLength(1);
        expect(fx.seen.in_flight).toBe(4);

        await advance(10 * MINUTE);
        await fx.site.settle();

        /* The old pass made the four it had in flight and no other,
         * although the maker was running again while eight of its
         * list still waited. */
        expect(old.result).toBe(4);
        expect(fx.log.creates().slice(0, 4)).toEqual(started.map(m => m.dataset));
        /* The new pass started when the old one had ended, and made
         * the rest from the inputs as they were then. */
        const [, next] = fx.seen.passes;
        expect(next.start).toBeGreaterThanOrEqual(old.end);
        expect(next.items).toBe(8);
        expect(next.result).toBe(8);
        expect(fx.seen.most_running).toBe(1);
        expect(fx.seen.most_in_flight).toBe(4);

        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
        expect(fx.site.counters.calls.get("create_object")).toBe(12);
        expect_all_made(fx);
    });

    /* After an input error the retried subscription asks for a pass
     * while the first pass still runs, and that call waits. It
     * belongs to the subscription stop() ends. When the old pass
     * ends the maker is running again, so only the count of stops
     * shows the call is not the new run's. */
    test("and at once run, with a pass waiting behind another: the waiting pass is never started", async () => {
        const latency = 2500;
        const fx = rig(12, { site: { latency } });
        const placements = restartable(placements_of(fx.built));
        fx.maker.placements = placements.source;
        cleanup.push(() => placements.close());

        fx.maker.run();
        await advance(DEBOUNCE + 8 * SECOND);
        placements.fail();
        await advance(RETRY_DELAY + DEBOUNCE + SECOND);
        /* The second call waits for the first pass, which is on its
         * second batch of four. */
        expect(fx.seen.drains).toHaveLength(2);
        expect(fx.seen.drains[1].end).toBe(null);
        expect(fx.seen.passes).toHaveLength(1);
        const [old] = fx.seen.passes;

        fx.maker.stop();
        fx.maker.run();
        await advance(10 * MINUTE);
        await fx.site.settle();

        /* The call that waited made nothing and started no pass. The
         * new run asked for its own, which made the rest. */
        expect(old.result).toBe(8);
        expect(fx.seen.drains[1].result).toBe(0);
        expect(fx.seen.drains[1].end).toBeGreaterThanOrEqual(old.end);
        expect(fx.seen.drains).toHaveLength(3);
        expect(fx.seen.passes).toHaveLength(2);
        const [, next] = fx.seen.passes;
        expect(next.start).toBeGreaterThanOrEqual(old.end);
        expect(next.result).toBe(4);
        expect(fx.seen.drains[2].result).toBe(4);
        expect(fx.seen.most_running).toBe(1);

        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
        expect_all_made(fx);
    });

    test("before the first list: nothing is made", async () => {
        const fx = rig(5);

        fx.maker.run();
        await advance(DEBOUNCE - 100);
        fx.maker.stop();
        await advance(10 * MINUTE);

        expect(fx.log.calls).toHaveLength(0);
        expect(fx.seen.drains).toHaveLength(0);
        /* A pass asked for by hand makes nothing either. */
        expect(await fx.maker.drain()).toBe(0);
        expect(fx.log.calls).toHaveLength(0);
    });
});

describe("failures", () => {
    test("a dataset whose make fails is tried again on the next retry tick, and made once", async () => {
        const fx = rig(5, { site: { latency: 100 } });
        const bad = fx.missing[2];
        fx.site.failing = (method, ...args) =>
            method == "create_object" && args[1] == bad.dataset
                ? new Error("ConfigDB is down") : undefined;
        const attempts = () => fx.log.creates().filter(d => d == bad.dataset).length;

        fx.maker.run();
        await advance(MINUTE);

        /* The others are made. The pass that failed is followed by at
         * most one more, which the new datasets asked for. */
        expect(fx.log.uns_puts()).toHaveLength(4);
        expect(attempts()).toBeGreaterThanOrEqual(1);
        expect(attempts()).toBeLessThanOrEqual(2);
        const before = attempts();

        /* ConfigDB is back. Nothing happens until the tick. */
        fx.site.failing = null;
        await advance(RETRY_INTERVAL - MINUTE - SECOND);
        expect(attempts()).toBe(before);
        expect(fx.site.app(App.UNSDevice).has(bad.dataset)).toBe(false);

        await advance(MINUTE);
        expect(attempts()).toBe(before + 1);
        expect(fx.site.app(App.UNSDevice).get(bad.dataset))
            .toEqual({ source: bad.device });

        /* Later ticks find nothing to do. */
        await advance(3 * RETRY_INTERVAL);
        await fx.site.settle();
        expect(attempts()).toBe(before + 1);
        expect_each_once(fx.log.uns_puts(), fx.missing.map(m => m.dataset));
        expect_all_made(fx);
    });

    test("with ConfigDB down, a burst of triggers gives two failed attempts per dataset before the next tick", async () => {
        const fx = rig(10, { site: { latency: 3000 } });
        fx.site.failing = () => new Error("ConfigDB is down");

        fx.maker.run();
        /* The first pass takes three batches of 3 s. Three placement
         * changes during it each give a new list. */
        await advance(DEBOUNCE + 500);
        for (let i = 0; i < 3; i++) {
            fx.site.put(Placement, fx.built.placed[0], { node: `Node ${i}` });
            await advance(2500);
        }
        expect(fx.seen.running).toBe(1);
        expect(fx.seen.passes).toHaveLength(1);
        expect(fx.seen.triggers).toBeGreaterThanOrEqual(3);

        await advance(RETRY_INTERVAL - 30 * SECOND);

        /* Two passes: the one that was running, and one for every
         * list that arrived during it. */
        expect(fx.seen.passes.map(p => p.items)).toEqual([10, 10]);
        expect(fx.seen.passes.map(p => p.result)).toEqual([0, 0]);
        const creates = fx.log.creates();
        for (const { dataset } of fx.missing)
            expect(creates.filter(d => d == dataset)).toHaveLength(2);
        expect(fx.log.calls).toHaveLength(20);

        /* The tick tries each once more. */
        await advance(MINUTE);
        await fx.site.settle();
        expect(fx.log.creates()).toHaveLength(30);
        expect(fx.seen.most_running).toBe(1);
    });
});

describe("a dataset map that trails the writes", () => {
    test("by less than the settle time: no second create", async () => {
        const lag = 5 * SECOND;
        const fx = rig(8, { site: { latency: 100, notify_lag: lag } });
        const placements = restartable(placements_of(fx.built));
        fx.maker.placements = placements.source;
        cleanup.push(() => placements.close());
        expect(lag).toBeLessThan(SETTLE);

        fx.maker.run();
        /* The pass of two batches is over. The map shows none of it. */
        await advance(DEBOUNCE + 1500);
        expect(fx.seen.passes).toHaveLength(1);
        expect(fx.seen.passes[0].result).toBe(8);
        expect(fx.maker.latest.datasets.size).toBe(0);

        /* Something changes, so the maker looks again, and still sees
         * all eight as missing. */
        placements.next(placements_of(fx.built));
        await advance(DEBOUNCE + 500);
        expect(fx.seen.passes.map(p => p.items)).toEqual([8, 8]);
        expect(fx.seen.passes[1].result).toBe(0);
        expect(fx.log.creates()).toHaveLength(8);

        await advance(2 * RETRY_INTERVAL);
        await fx.site.settle();
        expect(fx.maker.latest.datasets.size).toBe(8);
        expect_each_once(fx.log.creates(), fx.missing.map(m => m.dataset));
        expect_all_made(fx);
    });

    /* The dataset map of 40 made datasets goes empty and comes back,
     * as it does when a source reconnects badly. The pass that the
     * empty map started stops making datasets once the map shows them
     * again. */
    test.each([
        ["during the first batch", 500, 4],
        ["during the second batch", CALLS_PER_MAKE * SECOND + 500, 8],
    ])("flap: the map comes back %s, and only what had started is made",
    async (_name, back_after, expected) => {
        const datasets = new rx.BehaviorSubject(null);
        const fx = rig(40, {
            site: { latency: 1000 },
            data: {
                datasets,
                default_devices: rx.NEVER,
                general_infos: rx.NEVER,
            },
        });
        cleanup.push(() => datasets.complete());
        const full = IMap(fx.missing.map(({ device, dataset }) =>
            [dataset, { structure: App.UNSDevice, config: { source: device } }]));

        datasets.next(full);
        fx.maker.run();
        await advance(10 * SECOND);
        expect(fx.log.calls).toHaveLength(0);

        datasets.next(IMap());
        await advance(DEBOUNCE + back_after);
        const started = fx.seen.makes;
        expect(started).toBe(expected);
        expect(fx.seen.passes).toHaveLength(1);
        expect(fx.seen.passes[0].items).toBe(40);

        datasets.next(full);
        await advance(4 * MINUTE);
        await fx.site.settle();

        expect(fx.site.counters.calls.get("create_object")).toBe(started);
        expect(fx.log.creates()).toEqual(
            fx.seen.passes[0].list.slice(0, started).map(m => m.dataset));
        expect(fx.seen.makes).toBe(started);
        expect(fx.seen.passes[0].result).toBe(started);
    });
});

describe("a dataset map that changes during a pass", () => {
    /* The pass reads the dataset map as it is when each dataset's
     * turn comes. The debounce only delays the lists that ask for a
     * pass: it must not delay what a running pass can see. */
    test("less than the debounce before a dataset's turn: the pass still skips it", async () => {
        const datasets = new rx.BehaviorSubject(IMap());
        const fx = rig(3, {
            site: { latency: 1000 },
            maker: { concurrency: 1 },
            data: {
                datasets,
                default_devices: rx.NEVER,
                general_infos: rx.NEVER,
            },
        });
        cleanup.push(() => datasets.complete());

        fx.maker.run();
        /* The first dataset is on its last call. */
        await advance(DEBOUNCE + 4500);
        const [pass] = fx.seen.passes;
        const [first, second, third] = pass.list;
        expect(fx.seen.makes).toBe(1);
        expect(fx.seen.in_flight).toBe(1);

        /* Somebody else makes the second, and the map shows it half a
         * second before its turn. */
        const before_turn = 500;
        expect(before_turn).toBeLessThan(fx.maker.debounce);
        datasets.next(IMap([[second.dataset, {
            structure: App.UNSDevice, config: { source: second.device } }]]));
        await advance(before_turn + 6 * SECOND);
        await fx.site.settle();

        expect(pass.result).toBe(2);
        expect(fx.log.creates()).toEqual([first.dataset, third.dataset]);
        expect(fx.log.objects().has(second.dataset)).toBe(false);
    });
});

/* A ConfigDB that answers at once and records its writes. */
function instant_cdb (hooks = {}) {
    const calls = { create: [], put: [] };
    const configs = new Map();
    const cdb = {
        async create_object (klass, obj) {
            await hooks.create?.(obj);
            calls.create.push(obj);
            return obj;
        },
        async put_config (app, obj, config) {
            calls.put.push({ app, obj, config });
            configs.set(`${app}/${obj}`, config);
        },
        async get_config (app, obj) { return configs.get(`${app}/${obj}`); },
    };
    return { cdb, calls };
}

const DEV_A = "aaaaaaaa-0000-4000-8000-000000000001";
const DEV_B = "aaaaaaaa-0000-4000-8000-000000000002";
const NODE = "cccccccc-0000-4000-8000-000000000001";
const DEF_A = default_dataset_uuid(DEV_A);
const DEF_B = default_dataset_uuid(DEV_B);
const uns = device => ({ structure: App.UNSDevice, config: { source: device } });

function unit_maker (opts = {}) {
    return new DefaultDatasets({
        debug,
        data: { datasets: opts.datasets ?? rx.of(IMap()) },
        placements: rx.of(new Map()),
        devices: rx.of(new Set()),
        debounce: 0,
        ...opts,
    });
}

describe("the settle time", () => {
    test("with no `now`, a dataset made 59 s ago is skipped and one made 61 s ago is tried again", async () => {
        let time = 1_000_000;
        const { cdb, calls } = instant_cdb();
        const m = unit_maker({ cdb, clock: () => time });
        const missing = [{ device: DEV_A, dataset: DEF_A }];

        expect(await m.make_all(missing)).toBe(1);
        time += 59 * SECOND;
        expect(await m.make_all(missing)).toBe(0);
        expect(calls.create).toEqual([DEF_A]);
        time += 2 * SECOND;
        expect(await m.make_all(missing)).toBe(1);
        expect(calls.create).toEqual([DEF_A, DEF_A]);
    });

    test("counts from when the dataset was finished, not from when the pass started", async () => {
        const start = 1_000_000;
        let time = start;
        /* The first dataset takes 100 s to make. */
        const { cdb, calls } = instant_cdb({
            create: obj => { if (obj == DEF_A) time += 100 * SECOND; } });
        const m = unit_maker({ cdb, clock: () => time, concurrency: 1 });
        const missing = [
            { device: DEV_A, dataset: DEF_A }, { device: DEV_B, dataset: DEF_B }];

        expect(await m.make_all(missing)).toBe(2);
        expect(m.made.get(DEF_A)).toBe(start + 100 * SECOND);
        expect(m.made.get(DEF_B)).toBe(start + 100 * SECOND);

        /* Straight after the pass nothing is made again, although the
         * pass started more than 60 s ago. */
        expect(time - start).toBeGreaterThan(SETTLE);
        expect(await m.make_all(missing)).toBe(0);
        expect(calls.create).toEqual([DEF_A, DEF_B]);
    });

    test("is measured when a dataset's turn comes, not when the pass starts", async () => {
        const start = 1_000_000;
        let time = start;
        /* The first dataset takes 2 s to make. */
        const { cdb, calls } = instant_cdb({
            create: obj => { if (obj == DEF_A) time += 2 * SECOND; } });
        const m = unit_maker({ cdb, clock: () => time, concurrency: 1 });
        /* The second was made 59 s before the pass starts: too new
         * to make again then, and old enough when its turn comes. */
        m.made.set(DEF_B, start - 59 * SECOND);

        expect(await m.make_all([
            { device: DEV_A, dataset: DEF_A }, { device: DEV_B, dataset: DEF_B },
        ])).toBe(2);
        expect(calls.create).toEqual([DEF_A, DEF_B]);
    });

    test("an explicit `now` is used for every dataset, whatever the clock says", async () => {
        let time = 5_000_000;
        const { cdb } = instant_cdb({ create: () => { time += 100 * SECOND; } });
        const m = unit_maker({ cdb, clock: () => time });

        await m.make_all([{ device: DEV_A, dataset: DEF_A }], 1000);
        expect(m.made.get(DEF_A)).toBe(1000);
    });
});

describe("the newest inputs", () => {
    test("inputs keeps each value in `latest` before the debounce", async () => {
        const placements = new Map([[DEV_A, { node: NODE }]]);
        const devices = new Set([DEV_A]);
        const m = unit_maker({
            cdb: instant_cdb().cdb,
            placements: rx.of(placements),
            devices: rx.of(devices),
            debounce: 60 * MINUTE,
        });
        expect(m.latest).toBe(null);

        const value = await rx.firstValueFrom(
            m.inputs().pipe(rx.timeout(SECOND)));
        expect(m.latest).toBe(value);
        expect(value.placements).toBe(placements);
        expect(value.devices).toBe(devices);
        expect(value.datasets.size).toBe(0);
    });

    test("drain makes nothing before the inputs have answered", async () => {
        const { cdb, calls } = instant_cdb();
        const m = unit_maker({ cdb });
        expect(await m.drain()).toBe(0);
        expect(calls.create).toEqual([]);
    });

    test("drain reads the newest inputs, and leaves `draining` clear when it ends", async () => {
        const { cdb, calls } = instant_cdb();
        const m = unit_maker({ cdb });
        m.latest = {
            placements: new Map([[DEV_A, { node: NODE }], [DEV_B, { node: NODE }]]),
            devices: new Set([DEV_A, DEV_B]),
            datasets: IMap({ [DEF_A]: uns(DEV_A) }),
        };

        const pass = m.drain();
        await Promise.resolve();
        expect(m.draining).not.toBe(null);
        expect(await pass).toBe(1);
        expect(calls.create).toEqual([DEF_B]);
        expect(m.draining).toBe(null);
    });

    test("two drains asked for together run one after the other", async () => {
        const order = [];
        const gates = [];
        const { cdb } = instant_cdb({
            create: obj => new Promise(resolve => {
                order.push(`start ${obj}`);
                gates.push(() => { order.push(`end ${obj}`); resolve(); });
            }),
        });
        const m = unit_maker({ cdb, settle: 0 });
        m.latest = {
            placements: new Map([[DEV_A, { node: NODE }]]),
            devices: new Set([DEV_A]),
            datasets: IMap(),
        };
        const turn = () => new Promise(r => setImmediate(r));

        const both = Promise.all([m.drain(), m.drain(), m.drain()]);
        await turn();
        expect(gates).toHaveLength(1);
        gates.shift()();
        await turn();
        expect(gates).toHaveLength(1);
        gates.shift()();
        await turn();
        expect(gates).toHaveLength(1);
        gates.shift()();

        expect(await both).toEqual([1, 1, 1]);
        expect(order).toEqual([
            `start ${DEF_A}`, `end ${DEF_A}`,
            `start ${DEF_A}`, `end ${DEF_A}`,
            `start ${DEF_A}`, `end ${DEF_A}`,
        ]);
    });

    test("a pass that waits its turn when the maker is stopped is never started", async () => {
        const gates = [];
        const { cdb, calls } = instant_cdb({
            create: () => new Promise(resolve => gates.push(resolve)) });
        const m = unit_maker({ cdb, settle: 0 });
        m.latest = {
            placements: new Map([[DEV_A, { node: NODE }]]),
            devices: new Set([DEV_A]),
            datasets: IMap(),
        };
        const passes = vi.spyOn(m, "make_all");
        const turn = () => new Promise(r => setImmediate(r));

        const both = Promise.all([m.drain(), m.drain()]);
        await turn();
        expect(passes).toHaveBeenCalledTimes(1);
        expect(gates).toHaveLength(1);

        m.stop();
        gates.shift()();
        /* The dataset in flight was finished. The second pass was not
         * started: it read nothing and listed nothing. */
        expect(await both).toEqual([1, 0]);
        expect(passes).toHaveBeenCalledTimes(1);
        expect(calls.create).toEqual([DEF_A]);
    });

    test("a pass skips a dataset the map shows by the time its turn comes", async () => {
        const { cdb, calls } = instant_cdb();
        const m = unit_maker({ cdb });
        m.latest = { datasets: IMap({ [DEF_A]: uns(DEV_A) }) };

        const missing = [
            { device: DEV_A, dataset: DEF_A }, { device: DEV_B, dataset: DEF_B }];
        expect(await m.make_all(missing)).toBe(1);
        expect(calls.create).toEqual([DEF_B]);
        /* Skipped, not made: no settle time is counted for it. */
        expect(m.made.has(DEF_A)).toBe(false);
    });

    test("a stopped maker's pass makes nothing", async () => {
        const { cdb, calls } = instant_cdb();
        const m = unit_maker({ cdb });
        m.stop();
        expect(await m.make_all([{ device: DEV_A, dataset: DEF_A }])).toBe(0);
        expect(calls.create).toEqual([]);
    });
});

describe("default dataset names under a burst", () => {
    const devices = [DEV_A, DEV_B, "aaaaaaaa-0000-4000-8000-000000000003"];
    const defaults = new Map(devices.map(d => [default_dataset_uuid(d), d]));
    const names = tag => IMap(devices.map((d, i) => [d, { name: `${tag} ${i}` }]));

    /* The maker over test-held names, with a slow ConfigDB. Only the
     * rename half has anything to do. */
    function rename_rig (latency) {
        vi.useFakeTimers();
        const site = make_site({ latency });
        const infos = restartable(names("First"));
        const { cdb, log } = logged(site.cdb);
        const maker = new DefaultDatasets({
            debug, cdb,
            data: {
                datasets: rx.NEVER,
                default_devices: new rx.BehaviorSubject(defaults),
                general_infos: infos.source,
            },
            placements: rx.NEVER,
            devices: rx.NEVER,
        });
        const seen = probe(maker);
        cleanup.push(() => {
            maker.stop();
            infos.close();
            site.close();
        });
        return { site, infos, maker, seen, log };
    }

    const expect_names = (site, tag) => {
        for (const [dataset, device] of defaults)
            expect(site.app(Info).get(dataset))
                .toEqual({ name: names(tag).get(device).name });
    };

    test("name changes during a slow pass give one further pass, never two at once", async () => {
        /* A name takes a read and a write of 3 s each: 18 s a pass. */
        const fx = rename_rig(3000);

        fx.maker.run();
        await advance(DEBOUNCE + SECOND);
        expect(fx.seen.renaming).toBe(1);

        /* Four changes, far enough apart for each to give a list. */
        for (const tag of ["Second", "Third", "Fourth", "Fifth"]) {
            fx.infos.next(names(tag));
            await advance(3 * SECOND);
        }
        expect(fx.seen.rename_triggers).toBe(5);
        expect(fx.seen.rename_passes).toHaveLength(1);
        expect(fx.seen.renaming).toBe(1);

        await advance(5 * MINUTE);
        await fx.site.settle();

        expect(fx.seen.rename_passes).toHaveLength(2);
        expect(fx.seen.most_renaming).toBe(1);
        const [first, second] = fx.seen.rename_passes;
        expect(second.start).toBeGreaterThanOrEqual(first.end);
        expect([first.result, second.result]).toEqual([3, 3]);
        /* The second pass set the newest names, not the ones that
         * were newest when it was asked for. */
        expect_names(fx.site, "Fifth");
        expect(fx.log.of("put_config")).toHaveLength(6);
    });

    test("an error on the names in the middle of a pass starts no second pass beside it", async () => {
        const fx = rename_rig(3000);

        fx.maker.run();
        await advance(DEBOUNCE + 3 * SECOND);
        expect(fx.seen.renaming).toBe(1);

        fx.infos.fail();
        await advance(RETRY_DELAY + DEBOUNCE + SECOND);
        expect(fx.infos.subscribes).toBe(2);
        expect(fx.seen.rename_drains).toHaveLength(2);
        expect(fx.seen.rename_passes).toHaveLength(1);
        expect(fx.seen.renaming).toBe(1);

        await advance(5 * MINUTE);
        await fx.site.settle();

        expect(fx.seen.most_renaming).toBe(1);
        expect(fx.seen.rename_passes).toHaveLength(2);
        const [first, second] = fx.seen.rename_passes;
        expect(second.start).toBeGreaterThanOrEqual(first.end);
        expect(fx.seen.rename_drains[1].start).toBeLessThan(first.end);
        /* The names were set once: the second pass found them right. */
        expect([first.result, second.result]).toEqual([3, 0]);
        expect(fx.log.of("put_config")).toHaveLength(3);
        expect_names(fx.site, "First");
    });

    test("stop in the middle of a pass: the name being set is finished, and no call follows for the rest", async () => {
        /* A name takes a read and a write of 3 s each. */
        const fx = rename_rig(3000);

        fx.maker.run();
        /* The read of the first name is in flight. */
        await advance(DEBOUNCE + SECOND);
        expect(fx.seen.renaming).toBe(1);
        expect(fx.log.calls).toHaveLength(1);
        const [first] = fx.seen.rename_passes[0].list;

        fx.maker.stop();
        await advance(10 * MINUTE);
        await fx.site.settle();

        /* The one name was read and written. Nothing was asked about
         * the other two. */
        expect(fx.log.calls.map(c => [c.method, c.args[1]])).toEqual([
            ["get_config", first.dataset], ["put_config", first.dataset]]);
        expect(fx.site.app(Info).get(first.dataset)).toEqual({ name: first.name });
        expect(fx.seen.rename_passes).toHaveLength(1);
        expect(fx.seen.rename_passes[0].result).toBe(1);
        expect(fx.seen.renaming).toBe(0);
    });

    test("stop and at once run, in the middle of a pass: the old pass sets no further name, and the new one waits for it", async () => {
        const fx = rename_rig(3000);

        fx.maker.run();
        await advance(DEBOUNCE + SECOND);
        expect(fx.seen.renaming).toBe(1);
        const [old] = fx.seen.rename_passes;

        fx.maker.stop();
        fx.maker.run();
        await advance(5 * MINUTE);
        await fx.site.settle();

        /* The old pass finished the name it was setting and stopped,
         * although the maker was running again. */
        expect(old.result).toBe(1);
        const [, next] = fx.seen.rename_passes;
        expect(next.start).toBeGreaterThanOrEqual(old.end);
        expect(fx.seen.most_renaming).toBe(1);
        /* Each name was written once. */
        expect(fx.log.of("put_config")).toHaveLength(3);
        expect_names(fx.site, "First");
    });

    test("stop and at once run, with a pass waiting behind another: the waiting pass is never started", async () => {
        const fx = rename_rig(3000);

        fx.maker.run();
        await advance(DEBOUNCE + 3 * SECOND);
        fx.infos.fail();
        await advance(RETRY_DELAY + DEBOUNCE + SECOND);
        /* The second call waits for the first pass, which is setting
         * its second name. */
        expect(fx.seen.rename_drains).toHaveLength(2);
        expect(fx.seen.rename_drains[1].end).toBe(null);
        expect(fx.seen.rename_passes).toHaveLength(1);
        const [old] = fx.seen.rename_passes;

        fx.maker.stop();
        fx.maker.run();
        await advance(5 * MINUTE);
        await fx.site.settle();

        expect(old.result).toBe(2);
        expect(fx.seen.rename_drains[1].result).toBe(0);
        expect(fx.seen.rename_drains).toHaveLength(3);
        expect(fx.seen.rename_passes).toHaveLength(2);
        const [, next] = fx.seen.rename_passes;
        expect(next.start).toBeGreaterThanOrEqual(old.end);
        expect(next.result).toBe(1);
        expect(fx.seen.most_renaming).toBe(1);
        expect(fx.log.of("put_config")).toHaveLength(3);
        expect_names(fx.site, "First");
    });

    /* Every name is right here, so no list and no pass follows a
     * retry: only the inputs show that the retry worked. */
    test("errors on the names with an answer between them are each retried at the first delay", async () => {
        const fx = rename_rig(0);
        const right = names("First").merge(IMap(
            [...defaults].map(([dataset, device]) =>
                [dataset, names("First").get(device)])));
        fx.infos.next(right);

        fx.maker.run();
        await advance(MINUTE);

        for (let errors = 1; errors <= 5; errors++) {
            fx.infos.fail();
            await advance(RETRY_DELAY - 100);
            expect(fx.infos.subscribes).toBe(errors);
            await advance(200);
            expect(fx.infos.subscribes).toBe(errors + 1);
            await advance(MINUTE);
        }
        expect(fx.seen.rename_triggers).toBe(0);
        expect(fx.log.calls).toHaveLength(0);
    });

    test("errors on the names in a row are retried later each time", async () => {
        const fx = rename_rig(0);
        const tries = [];
        fx.maker.data.general_infos = rx.defer(() => {
            tries.push(Date.now());
            return tries.length <= 4
                ? rx.throwError(() => new Error("The source failed"))
                : fx.infos.source;
        });

        fx.maker.run();
        await advance(5 * MINUTE);
        await fx.site.settle();

        expect(tries.slice(1).map((t, i) => (t - tries[i]) / SECOND))
            .toEqual([5, 10, 20, 40]);
        expect_names(fx.site, "First");
    });

    test("a stopped maker starts no rename pass", async () => {
        const fx = rename_rig(0);
        fx.maker.latest_names = { defaults, infos: names("First") };
        fx.maker.stop();
        expect(await fx.maker.rename_drain()).toBe(0);
        expect(fx.log.calls).toHaveLength(0);
    });
});

describe("default_dataset_uuid", () => {
    const direct = device =>
        uuidv5(device, Constants.Special.DefaultDatasetNamespace);
    const device = n =>
        `dddddddd-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

    test("gives the same answer however many devices have been asked for", () => {
        const first = device(0);
        expect(default_dataset_uuid(first)).toBe(direct(first));

        /* More than the 50,000 answers the function keeps. */
        for (let n = 1; n <= 50100; n++) default_dataset_uuid(device(n));

        expect(default_dataset_uuid(first)).toBe(direct(first));
        for (const n of [1, 49999, 50000, 50001, 50100])
            expect(default_dataset_uuid(device(n))).toBe(direct(device(n)));
    });

    test("keeps no answer for something that is not a device UUID", () => {
        expect(() => default_dataset_uuid(undefined)).toThrow();
        expect(() => default_dataset_uuid(undefined)).toThrow();
    });

    /* A stored UNS device config can name any string as its device,
     * and every dataset list asks for the default dataset of each. */
    test("keeps the answer for a device UUID, and none for a string of another length", () => {
        const junk = "x".repeat(5000);
        const known = device(60000);
        const kept = vi.spyOn(Map.prototype, "set");
        try {
            expect(default_dataset_uuid(junk)).toBe(direct(junk));
            expect(default_dataset_uuid(junk)).toBe(direct(junk));
            expect(default_dataset_uuid("")).toBe(direct(""));
            expect(default_dataset_uuid(known)).toBe(direct(known));
            expect(default_dataset_uuid(known)).toBe(direct(known));

            const keys = kept.mock.calls.map(([key]) => key);
            expect(keys.filter(key => key === known)).toHaveLength(1);
            expect(keys.filter(key => key === junk || key === "")).toEqual([]);
        }
        finally {
            kept.mockRestore();
        }
    });
});
