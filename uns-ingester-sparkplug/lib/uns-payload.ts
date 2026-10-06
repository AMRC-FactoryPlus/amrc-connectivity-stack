/*
 * AMRC ACS UNS Ingester (Sparkplug)
 * Building the UNS payload for one topic
 * Copyright 2026 AMRC
 */

export interface UnsMetric {
    value: string,
    timestamp: string,
    batch?: UnsMetric[]
}

/**
 * Convert a nanosecond BigInt to an ISO 8601 string with nanosecond
 * precision, e.g. "2026-05-28T15:46:56.100923659Z". Falls back to
 * millisecond precision when no nanosecond value is available.
 */
export function ns_to_iso(ns: bigint): string {
    const ms = ns / 1_000_000n;
    const subMs = ns % 1_000_000n;
    const date = new Date(Number(ms));
    return date.toISOString().slice(0, -1) + subMs.toString().padStart(6, '0') + 'Z';
}

/** The parts of a decoded Sparkplug metric we use. */
export interface SampledMetric {
    value: any,
    timestamp: Date,
    timestampNs?: bigint,
}

/** A metric's timestamp in nanoseconds, from timestampNs if present. */
function metric_ns(m: SampledMetric): bigint {
    return m.timestampNs ?? BigInt(m.timestamp.getTime()) * 1_000_000n;
}

/**
 * Build the UNS payload for the samples of one metric from one
 * Sparkplug payload. `value` and `timestamp` are the newest sample, as
 * a consumer reading the current value expects; any older samples go
 * in `batch`, oldest first. Equal timestamps keep their order in the
 * Sparkplug payload, so the last of them is the value.
 */
export function buildUnsPayload(metrics: SampledMetric[]): UnsMetric {
    if (metrics.length === 0)
        throw new RangeError("buildUnsPayload needs at least one metric");

    /* Sort by nanosecond timestamp. BigInt comparison returns -1/0/1
     * to satisfy the sort comparator contract; Array.prototype.sort
     * is stable. */
    const sorted = [...metrics].sort((a, b) => {
        const aNs = metric_ns(a);
        const bNs = metric_ns(b);
        return aNs < bNs ? -1 : aNs > bNs ? 1 : 0;
    });
    const newest = sorted.pop()!;
    const payload: UnsMetric = {
        timestamp: ns_to_iso(metric_ns(newest)),
        value: newest.value,
    };
    if (sorted.length > 0) {
        payload.batch = sorted.map(m => ({
            timestamp: ns_to_iso(metric_ns(m)),
            value: m.value,
        }));
    }
    return payload;
}
