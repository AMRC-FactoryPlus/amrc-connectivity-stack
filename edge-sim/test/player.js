/*
 * ACS simulator driver
 * Player tests: transport and the virtual clock.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert from "node:assert";
import { test } from "node:test";

import { validateCassette } from "../lib/cassette.js";
import { Player, Status } from "../lib/player.js";

const CASSETTE = validateCassette({
    cassette: { name: "test", version: 1, duration_ms: 10000 },
    channels: [
        { id: 0, path: "State/Cycle" },
        { id: 1, path: "Axes/X/Position" },
    ],
    samples: [
        [0, 0, "Running"],
        [1000, 1, 1.5],
        [2000, 1, 2.5],
        [5000, 1, 5.5],
        [9000, 0, "Idle"],
    ],
});

/* A player on a manual clock: advance() moves wall time and fires the
 * tick, exactly as the interval timer would. */
function harness (opts = {}) {
    let wall = opts.wall ?? 1_000_000;
    const emitted = [];
    const player = new Player({
        emit:       (path, value, stamp) =>
            emitted.push([path, value, stamp]),
        now:        () => wall,
        setTimer:   () => "timer",
        clearTimer: () => {},
        ...opts.player,
    });
    const advance = ms => { wall += ms; player.tick(); };
    return { player, emitted, advance, wall: () => wall };
}

test("stamps are start_time + offset, at any rate", () => {
    const { player, emitted, advance } = harness();
    player.load(CASSETTE);
    player.play({ start_time: 500_000, rate: 50 });
    advance(200);   /* 10 s of virtual time in 200 ms of wall time */

    assert.deepStrictEqual(emitted, [
        ["State/Cycle", "Running", 500_000],
        ["Axes/X/Position", 1.5, 501_000],
        ["Axes/X/Position", 2.5, 502_000],
        ["Axes/X/Position", 5.5, 505_000],
        ["State/Cycle", "Idle", 509_000],
    ]);
    assert.strictEqual(player.status, Status.ENDED);
});

test("start_time defaults to the current time", () => {
    const { player, emitted, advance } = harness();
    player.load(CASSETTE);
    player.play({});
    assert.strictEqual(player.startTime, 1_000_000);
    advance(1000);
    assert.deepStrictEqual(emitted, [
        ["State/Cycle", "Running", 1_000_000],
        ["Axes/X/Position", 1.5, 1_001_000],
    ]);
});

test("a future start_time gives future stamps", () => {
    const { player, emitted, advance } = harness();
    player.load(CASSETTE);
    player.play({ start_time: 2_000_000 });
    advance(1500);
    /* Emission starts when Play is sent; stamps are on the future
     * timeline regardless. */
    assert.deepStrictEqual(emitted[0], ["State/Cycle", "Running", 2_000_000]);
    assert.deepStrictEqual(emitted[1], ["Axes/X/Position", 1.5, 2_001_000]);
});

test("rate change mid-play alters pacing, not stamps", () => {
    const { player, emitted, advance } = harness();
    player.load(CASSETTE);
    player.play({ start_time: 500_000, rate: 1 });
    advance(1000);      /* position 1000 */
    player.setRate(10);
    advance(400);       /* position 5000 */
    assert.deepStrictEqual(emitted.map(e => e[2]),
        [500_000, 501_000, 502_000, 505_000]);
});

test("pause holds position; resume keeps the stamp anchor", () => {
    const { player, emitted, advance } = harness();
    player.load(CASSETTE);
    player.play({ start_time: 500_000 });
    advance(1000);
    player.pause();
    assert.strictEqual(player.status, Status.PAUSED);
    advance(60_000);    /* a minute passes; nothing emitted */
    assert.strictEqual(emitted.length, 2);
    player.play({});
    advance(1000);      /* position 2000 */
    assert.deepStrictEqual(emitted.at(-1),
        ["Axes/X/Position", 2.5, 502_000]);
});

test("seek jumps position; stamps stay on the original timeline", () => {
    const { player, emitted, advance } = harness();
    player.load(CASSETTE);
    player.play({ start_time: 500_000 });
    player.seek(4500);
    advance(600);
    assert.deepStrictEqual(emitted, [
        ["Axes/X/Position", 5.5, 505_000],
    ]);
    /* Seek backwards re-emits earlier offsets with earlier stamps. */
    player.seek(500);
    advance(600);
    assert.deepStrictEqual(emitted.at(-1),
        ["Axes/X/Position", 1.5, 501_000]);
});

test("same cassette and start time reproduce identical stamps", () => {
    const runs = [1, 100].map(rate => {
        const { player, emitted, advance } = harness();
        player.load(CASSETTE);
        player.play({ start_time: 42_000, rate });
        for (let i = 0; i < 200; i++) advance(100);
        return emitted;
    });
    assert.deepStrictEqual(runs[0], runs[1]);
});

test("stop rewinds; play restarts with a fresh default anchor", () => {
    const { player, emitted, advance } = harness();
    player.load(CASSETTE);
    player.play({});
    advance(1000);
    player.stop();
    assert.strictEqual(player.position, 0);
    advance(5000);
    player.play({});
    assert.strictEqual(player.startTime, 1_006_000);
    advance(100);
    assert.deepStrictEqual(emitted.at(-1),
        ["State/Cycle", "Running", 1_006_000]);
});

test("transport with no cassette loaded throws", () => {
    const { player } = harness();
    for (const call of ["play", "pause", "stop"])
        assert.throws(() => player[call]({}), /no cassette loaded/);
    assert.throws(() => player.seek(0), /no cassette loaded/);
});

test("loop wraps seamlessly with monotonic stamps", () => {
    const { player, emitted, advance } = harness();
    player.load(CASSETTE);
    player.play({ start_time: 100_000, rate: 100, loop: true });
    /* 25 s of virtual time = 2.5 passes of a 10 s tape, in 100 ms
     * ticks as the real interval timer would deliver them */
    for (let i = 0; i < 25; i++) advance(10);
    assert.strictEqual(player.status, Status.PLAYING);
    /* First sample of each pass carries the advanced anchor */
    const starts = emitted.filter(e => e[1] === "Running").map(e => e[2]);
    assert.deepStrictEqual(starts, [100_000, 110_000, 120_000]);
    /* Stamps never repeat or go backwards */
    const stamps = emitted.map(e => e[2]);
    for (let i = 1; i < stamps.length; i++)
        assert.ok(stamps[i] >= stamps[i - 1], `stamp ${i} regressed`);
    player.stop();
    assert.strictEqual(player.status, Status.LOADED);
});

test("rates outside 0-100 are rejected", () => {
    const { player } = harness();
    player.load(CASSETTE);
    assert.throws(() => player.play({ rate: 101 }), /Bad rate/);
    assert.throws(() => player.setRate(-1), /Bad rate/);
});
