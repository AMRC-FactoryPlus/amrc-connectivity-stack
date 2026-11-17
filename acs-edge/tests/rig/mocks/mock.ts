/*
 * ACS Edge Agent
 * Split-driver cluster rig: what every mock device has in common
 * Copyright 2026 University of Sheffield
 *
 * A mock replays a synthetic fixture (see tests/fixtures/drivers) in a
 * loop for as long as it runs, at real speed, so a connection pointed
 * at it sees values that keep changing in the shapes, types and rates
 * its real device gives. Unlike the golden harness's fake devices,
 * which replay a fixture once as fast as possible for a comparison,
 * mocks listen on fixed ports on every interface and can be stopped
 * and started to take a device offline.
 */

import type { Fixture, FixtureEvent } from "../../fixtures/drivers/fixture.js";
import type { RigConnection } from "../rig.js";

export interface MockStatus {
    id:         string,
    protocol:   string,
    name:       string,
    port:       number,
    running:    boolean,
    /* Messages, responses or value changes delivered. */
    delivered:  number,
    /* Clients connected now, where the mock can see them. */
    clients?:   number,
    /* Requests refused for bad credentials. */
    refused?:   number,
    /* Writes the connection made, newest last (at most 20). */
    writes?:    { at: string, address: string, value: string }[],
}

export interface Mock {
    readonly conn: RigConnection,
    start (): Promise<void>,
    stop (): Promise<void>,
    status (): MockStatus,
}

export const sleep = (ms: number) =>
    new Promise<void>(resolve => setTimeout(resolve, ms));

/* Plays a fixture's events in a loop at their times. Each pass starts
 * from the fixture's first event again, which for OPC UA holds every
 * node, so the values jump back to their starting point once a pass. */
export class Looper<E extends FixtureEvent> {
    events:     E[]
    duration:   number
    #running = false
    #done?:     Promise<void>

    constructor (fixture: Fixture, events: E[]) {
        this.events = [...events].sort((a, b) => a.t - b.t);
        const last = this.events.at(-1)?.t ?? 0;
        this.duration = Math.max(fixture.meta.duration_ms, last + 1);
    }

    start (apply: (ev: E) => void | Promise<void>) {
        if (this.#running) return;
        this.#running = true;
        this.#done = (async () => {
            while (this.#running) {
                const start = Date.now();
                for (const ev of this.events) {
                    if (!this.#running) return;
                    const wait = start + ev.t - Date.now();
                    if (wait > 0) await sleep(wait);
                    if (!this.#running) return;
                    try { await apply(ev); }
                    catch (e) { console.log("Replay: %s", e); }
                }
                const rest = start + this.duration - Date.now();
                if (rest > 0) await sleep(rest);
            }
        })();
    }

    async stop () {
        this.#running = false;
        await this.#done;
    }
}

/* Keep the last few writes for the status report. */
export function record_write (list: MockStatus["writes"] & {}, address: string, value: any) {
    list.push({
        at: new Date().toISOString(), address,
        value: typeof value == "string" ? value : JSON.stringify(value),
    });
    while (list.length > 20) list.shift();
}
