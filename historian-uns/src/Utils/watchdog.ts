/*
 * AMRC Connectivity Stack
 * Stall detection for MQTT consumers.
 * Copyright 2026 AMRC
 *
 * A consumer can end up running with a live event loop but no working
 * MQTT connection or subscription: its timers keep logging, the pod
 * stays Running and Ready, and no data moves. This module turns that
 * silent failure into a loud one. If no message arrives on the
 * subscribed topics for a configurable period, the service is told to
 * give up, so Kubernetes restarts it with a fresh MQTT connection and
 * fresh Kerberos credentials.
 *
 * This file is copied, unchanged, into historian-sparkplug,
 * historian-uns and uns-ingester-sparkplug. Keep the copies identical.
 * It has no imports so the tests can load it directly.
 */

/** Default stall timeout, in seconds. */
export const DEFAULT_STALL_TIMEOUT_S = 600;

/** Parse the STALL_TIMEOUT environment variable.
 *
 * The value is a whole number of seconds. Unset or empty gives the
 * default. Zero disables the watchdog. Anything else is a
 * configuration error and throws, so a typo cannot quietly turn the
 * watchdog off.
 *
 * @returns The timeout in milliseconds, or 0 if disabled.
 */
export function parseStallTimeout (raw: string | undefined): number {
    if (raw === undefined || raw.trim() === "")
        return DEFAULT_STALL_TIMEOUT_S * 1000;
    if (!/^\d+$/.test(raw.trim()))
        throw new Error(`STALL_TIMEOUT must be a whole number of seconds (0 disables), got "${raw}"`);
    return Number.parseInt(raw.trim(), 10) * 1000;
}

/** Find the failed entries in a SUBACK.
 *
 * MQTT.js 5 reports a refused subscription as an error whose `code`
 * is the SUBACK reason code. Older versions pass the reason codes in
 * `granted` instead. Any code with the 0x80 bit set is a failure (for
 * example 0x87 Not authorized).
 *
 * An error without a reason code (for example "Connection closed"
 * when the connection drops before the SUBACK arrives) is not a
 * refusal: MQTT.js resubscribes when it reconnects.
 *
 * @returns A description of each refusal; empty if none.
 */
export function subscriptionFailures (err: any, granted: any): string[] {
    const failures: string[] = [];

    if (err && typeof err.code === "number" && (err.code & 0x80))
        failures.push(`${err.message ?? "Subscribe error"} (reason code 0x${err.code.toString(16)})`);

    const list = Array.isArray(granted) ? granted
        : Array.isArray(granted?.granted) ? granted.granted
        : [];
    for (const g of list) {
        const code = typeof g === "number" ? g : g?.qos;
        if (typeof code === "number" && (code & 0x80)) {
            const topic = typeof g === "object" && g.topic ? `${g.topic}: ` : "";
            failures.push(`${topic}reason code 0x${code.toString(16)}`);
        }
    }

    return failures;
}

export interface StallWatchdogOptions {
    /** Give up after this many ms without activity. 0 disables. */
    timeoutMs: number;
    /** Called once, when the stall is detected. */
    onStall: (idleMs: number) => void;
    /** How often to check. Defaults to a quarter of the timeout,
     * capped at 30 s. */
    checkEveryMs?: number;
    /** Clock, for tests. */
    now?: () => number;
}

/** Fire a callback if `touch()` is not called often enough. */
export class StallWatchdog {
    private timeoutMs: number;
    private checkEveryMs: number;
    private onStall: (idleMs: number) => void;
    private now: () => number;
    private last: number;
    private timer: ReturnType<typeof setInterval> | null = null;
    private fired = false;

    constructor (opts: StallWatchdogOptions) {
        this.timeoutMs = opts.timeoutMs;
        this.onStall = opts.onStall;
        this.now = opts.now ?? Date.now;
        this.checkEveryMs = opts.checkEveryMs
            ?? Math.max(1000, Math.min(30_000, Math.floor(this.timeoutMs / 4)));
        this.last = this.now();
    }

    get enabled (): boolean {
        return this.timeoutMs > 0;
    }

    /** Milliseconds since the last activity (or since start). */
    idleMs (): number {
        return this.now() - this.last;
    }

    /** Record activity. */
    touch (): void {
        this.last = this.now();
    }

    /** Start the periodic check. The idle clock starts now. */
    start (): this {
        if (!this.enabled || this.timer) return this;
        this.last = this.now();
        this.timer = setInterval(() => this.check(), this.checkEveryMs);
        /* Don't hold the process open just for the watchdog. */
        this.timer.unref?.();
        return this;
    }

    stop (): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /** Check now. Fires `onStall` (once) and stops if the timeout has
     * passed.
     * @returns true if the watchdog fired. */
    check (): boolean {
        if (!this.enabled || this.fired) return false;
        const idle = this.idleMs();
        if (idle < this.timeoutMs) return false;
        this.fired = true;
        this.stop();
        this.onStall(idle);
        return true;
    }
}
