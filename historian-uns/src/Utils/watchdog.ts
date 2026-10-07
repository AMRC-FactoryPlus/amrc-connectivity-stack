/*
 * AMRC Connectivity Stack
 * Stall detection for MQTT consumers.
 * Copyright 2026 AMRC
 *
 * A consumer can end up running with a live event loop but no working
 * MQTT connection or subscription: its timers keep logging, the pod
 * stays Running and Ready, and no data moves. This module turns that
 * silent failure into a loud one. Once data has started to flow, if no
 * message then arrives on the subscribed topics for a configurable
 * period, the service is told to give up, so Kubernetes restarts it
 * with a fresh MQTT connection and fresh Kerberos credentials.
 *
 * The watchdog arms on the first message, not at startup. A site with
 * no traffic at all is not a fault, and must not restart every
 * timeout period. The cost: a service that never receives its first
 * message is not caught by the watchdog. The SUBACK check and the
 * logs cover part of that case.
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

export type SubscriptionOutcome =
    | { status: "granted" }
    | { status: "refused", detail: string }
    | { status: "unconfirmed", detail: string };

/** Classify the result of a subscribe() callback.
 *
 * - refused: the broker sent a failure reason code. Fatal.
 * - unconfirmed: no SUBACK we can trust. Either an error without a
 *   reason code (for example, the connection closed first) or an
 *   empty `granted` list, which MQTT.js returns without sending
 *   anything when it thinks the topic is already subscribed.
 * - granted: the broker accepted every topic.
 */
export function subscriptionOutcome (err: any, granted: any): SubscriptionOutcome {
    const failures = subscriptionFailures(err, granted);
    if (failures.length)
        return { status: "refused", detail: failures.join("; ") };
    if (err)
        return { status: "unconfirmed", detail: String(err.message ?? err) };
    const list = Array.isArray(granted) ? granted
        : Array.isArray(granted?.granted) ? granted.granted
        : [];
    if (list.length === 0)
        return { status: "unconfirmed", detail: "no SUBACK entries returned" };
    return { status: "granted" };
}

export interface StallWatchdogOptions {
    /** Give up after this many ms without activity. 0 disables. */
    timeoutMs: number;
    /** Called once, when the stall is detected. */
    onStall: (idleMs: number) => void;
    /** Called once, when the first message arms the watchdog. */
    onArm?: () => void;
    /** How often to check. Defaults to a quarter of the timeout,
     * capped at 30 s. */
    checkEveryMs?: number;
    /** Clock, for tests. */
    now?: () => number;
}

/** Fire a callback if `touch()` stops being called often enough.
 * The first `touch()` arms the watchdog; before that it never fires. */
export class StallWatchdog {
    private timeoutMs: number;
    private checkEveryMs: number;
    private onStall: (idleMs: number) => void;
    private onArm: () => void;
    private now: () => number;
    private last: number;
    private timer: ReturnType<typeof setInterval> | null = null;
    private fired = false;
    private _armed = false;

    constructor (opts: StallWatchdogOptions) {
        this.timeoutMs = opts.timeoutMs;
        this.onStall = opts.onStall;
        this.onArm = opts.onArm ?? (() => {});
        this.now = opts.now ?? Date.now;
        this.checkEveryMs = opts.checkEveryMs
            ?? Math.max(1000, Math.min(30_000, Math.floor(this.timeoutMs / 4)));
        this.last = this.now();
    }

    get enabled (): boolean {
        return this.timeoutMs > 0;
    }

    /** True once the first message has been seen. */
    get armed (): boolean {
        return this._armed;
    }

    /** Milliseconds since the last activity (or since construction,
     * before the watchdog is armed). */
    idleMs (): number {
        return this.now() - this.last;
    }

    /** Record activity. The first call arms the watchdog. */
    touch (): void {
        this.last = this.now();
        if (!this._armed && this.enabled) {
            this._armed = true;
            this.onArm();
        }
    }

    /** Start the periodic check. It does nothing until armed. */
    start (): this {
        if (!this.enabled || this.timer) return this;
        this.timer = setInterval(() => this.check(), this.checkEveryMs);
        /* Don't hold the process open just for the watchdog. */
        this.timer.unref?.();
        return this;
    }

    stop (): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /** Check now. If armed and the timeout has passed, fires
     * `onStall` (once) and stops.
     * @returns true if the watchdog fired. */
    check (): boolean {
        if (!this.enabled || !this._armed || this.fired) return false;
        const idle = this.idleMs();
        if (idle < this.timeoutMs) return false;
        this.fired = true;
        this.stop();
        this.onStall(idle);
        return true;
    }
}
