/*
 * ACS Edge Agent
 * Golden-output harness: change one recorded value, for the negative check
 * Copyright 2026 University of Sheffield
 */

import { parseValueFromPayload } from "../../lib/helpers/typeHandler.js";
import {
    Fixture, FixtureEvent, PayloadEvent, event_address, event_payload,
} from "../fixtures/drivers/fixture.js";
import { connection_metrics } from "../fixtures/drivers/metrics.js";

export interface Tampered {
    fixture:    Fixture,
    /* The metric whose value was changed. */
    device:     string,
    metric:     string,
    /* Which event was changed. */
    event:      number,
}

function body (ev: PayloadEvent) {
    return ev.type == "http" ? ev.body : ev.payload;
}

function with_body (ev: PayloadEvent, text: string): FixtureEvent {
    return ev.type == "http" ? { ...ev, body: text } : { ...ev, payload: text };
}

/* The payload's text with one number changed, or for a binary payload
 * its bytes with one byte changed, in each way that might reach a
 * metric. */
function* variants (ev: PayloadEvent): Generator<PayloadEvent> {
    const text = body(ev);
    if (ev.type != "http" && ev.encoding == "base64") {
        const bytes = Buffer.from(text, "base64");
        for (let i = 0; i < bytes.length; i++) {
            const changed = Buffer.from(bytes);
            changed[i] = (changed[i] + 7) & 0xff;
            yield with_body(ev, changed.toString("base64")) as PayloadEvent;
        }
        return;
    }
    for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g)) {
        const at = match.index!;
        const next = String(Number(match[0]) + 7);
        yield with_body(ev,
            text.slice(0, at) + next + text.slice(at + match[0].length)) as PayloadEvent;
    }
}

/* A copy of the fixture with one number in one event changed, and the
 * metric that change reaches. The change is made to the device input,
 * not to the output, so it shows the whole path from device to
 * comparison catches it. Starts from the second event so the metric
 * has a good value first. */
export function tamper (fixture: Fixture): Tampered {
    const cm = connection_metrics(fixture.connection);
    const events = fixture.events;

    for (let n = 1; n < events.length; n++) {
        const ev = events[n];

        if (ev.type == "opcua") {
            for (const [node, v] of Object.entries(ev.values)) {
                if (typeof v.value != "number") continue;
                const m = cm.read.find(r => r.address == node);
                if (!m) continue;
                const values = { ...ev.values, [node]: { ...v, value: v.value + 7 } };
                const changed = events.slice();
                changed[n] = { ...ev, values };
                return { fixture: { ...fixture, events: changed },
                    device: m.device, metric: m.name, event: n };
            }
            continue;
        }

        const addr = event_address(ev);
        const readers = cm.read.filter(r => r.address == addr);
        const parse = (e: PayloadEvent) => readers.map(r =>
            parseValueFromPayload(event_payload(e), r.metric,
                fixture.meta.payloadFormat, fixture.meta.delimiter));
        const before = parse(ev);

        for (const changed_ev of variants(ev)) {
            const after = parse(changed_ev);
            const i = after.findIndex((v, j) => v !== before[j]
                && v != null && !Number.isNaN(v));
            if (i < 0) continue;
            const changed = events.slice();
            changed[n] = changed_ev;
            return { fixture: { ...fixture, events: changed },
                device: readers[i].device, metric: readers[i].name, event: n };
        }
    }
    throw new Error(`Found no value to change in ${fixture.meta.name}`);
}
