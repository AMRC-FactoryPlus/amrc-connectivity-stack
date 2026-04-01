import { I3xQuality } from "./types/i3x.js";

export interface DeriveQualityOpts {
    online:     boolean;
    hasValue:   boolean;
    stale:      boolean;
}

/**
 * Derive an i3X quality value from device/metric state.
 *
 * Priority: offline always yields Bad; online without a value yields
 * GoodNoData regardless of staleness; online with a stale value yields
 * Uncertain; otherwise Good.
 */
export function deriveQuality (opts: DeriveQualityOpts): I3xQuality {
    const { online, hasValue, stale } = opts;

    if (!online)                return "Bad";
    if (!hasValue)              return "GoodNoData";
    if (stale)                  return "Uncertain";
    return "Good";
}

/**
 * Determine whether a timestamp is stale relative to a threshold.
 *
 * Returns true when the elapsed time since `timestamp` strictly exceeds
 * `thresholdMs`.
 */
export function isStale (timestamp: string | Date, thresholdMs: number): boolean {
    const ts = new Date(timestamp).getTime();
    return Date.now() - ts > thresholdMs;
}
