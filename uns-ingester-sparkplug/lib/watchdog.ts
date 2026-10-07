/*
 * AMRC Connectivity Stack
 * Stall and connection detection for MQTT consumers.
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
 * message is not caught by the stall watchdog.
 *
 * The connection watchdog covers that case without looking at
 * traffic. It tracks the MQTT client's state, and fires if the client
 * has not been connected with a granted subscription for a
 * configurable period, measured from startup or from the moment it
 * lost that state. A client that is connected and subscribed is
 * healthy however quiet the broker is.
 *
 * This file is copied, unchanged, into historian-sparkplug,
 * historian-uns and uns-ingester-sparkplug. Keep the copies identical.
 * It has no imports so the tests can load it directly.
 */

/** Default stall timeout, in seconds. */
export const DEFAULT_STALL_TIMEOUT_S = 600;

/** Default connection timeout, in seconds. Five minutes is well
 * beyond a normal broker restart (seconds to a minute or two,
 * including Kerberos start-up during an upgrade), and still shorter
 * than the default stall timeout. */
export const DEFAULT_CONNECT_TIMEOUT_S = 300;

/** Parse a timeout environment variable.
 *
 * The value is a whole number of seconds. Unset or empty gives the
 * default. Zero disables the check. Anything else is a configuration
 * error and throws, so a typo cannot quietly turn the check off.
 *
 * @returns The timeout in milliseconds, or 0 if disabled.
 */
export function parseTimeoutSeconds (name: string, raw: string | undefined, defaultS: number): number {
    if (raw === undefined || raw.trim() === "")
        return defaultS * 1000;
    if (!/^\d+$/.test(raw.trim()))
        throw new Error(`${name} must be a whole number of seconds (0 disables), got "${raw}"`);
    return Number.parseInt(raw.trim(), 10) * 1000;
}

/** Parse the STALL_TIMEOUT environment variable.
 * @returns The timeout in milliseconds, or 0 if disabled. */
export function parseStallTimeout (raw: string | undefined): number {
    return parseTimeoutSeconds("STALL_TIMEOUT", raw, DEFAULT_STALL_TIMEOUT_S);
}

/** Parse the CONNECT_TIMEOUT environment variable.
 * @returns The timeout in milliseconds, or 0 if disabled. */
export function parseConnectTimeout (raw: string | undefined): number {
    return parseTimeoutSeconds("CONNECT_TIMEOUT", raw, DEFAULT_CONNECT_TIMEOUT_S);
}

/** Find the failed entries in a SUBACK.
 *
 * MQTT.js reports a refused subscription in one of three ways,
 * depending on the version: an error whose `code` is the SUBACK
 * reason code (for example 5.10); an `ErrorWithSubackPacket` whose
 * `packet.granted` holds the reason codes, with no `code` (for
 * example 5.16); or reason codes in `granted` (4.x). Any code with
 * the 0x80 bit set is a failure (for example 0x87 Not authorized).
 *
 * An error without a reason code (for example "Connection closed"
 * when the connection drops before the SUBACK arrives) is not a
 * refusal: the service subscribes again on the next connect.
 *
 * @returns A description of each refusal; empty if none.
 */
export function subscriptionFailures (err: any, granted: any): string[] {
    const failures: string[] = [];

    if (err && typeof err.code === "number" && (err.code & 0x80))
        failures.push(`${err.message ?? "Subscribe error"} (reason code 0x${err.code.toString(16)})`);
    else if (err && Array.isArray(err.packet?.granted)) {
        const codes = err.packet.granted
            .filter((c: any) => typeof c === "number" && (c & 0x80));
        if (codes.length)
            failures.push(`${err.message ?? "Subscribe error"} (reason code ${
                codes.map((c: number) => `0x${c.toString(16)}`).join(", ")})`);
    }

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

export type ConnectionState = "disconnected" | "connected" | "subscribed";

export interface ConnectionWatchdogOptions {
    /** Give up after this many ms without a granted subscription.
     * 0 disables. */
    timeoutMs: number;
    /** Called once, when the timeout passes. `state` is the state at
     * that moment; `unhealthyMs` is how long the client has not been
     * subscribed. */
    onTimeout: (state: ConnectionState, unhealthyMs: number) => void;
    /** Called on every state change, for logging. `unhealthyMs` is
     * how long the client had been without a subscription before
     * this change (0 when it was subscribed). */
    onChange?: (state: ConnectionState, prev: ConnectionState, unhealthyMs: number) => void;
    /** How often to check. Defaults to a quarter of the timeout,
     * capped at 30 s. */
    checkEveryMs?: number;
    /** Clock, for tests. */
    now?: () => number;
}

/** Fire a callback if an MQTT client stays without a granted
 * subscription for too long.
 *
 * The service reports three events:
 *
 * - `connected()` when the client connects (for a GSSAPI client,
 *   once the server is authenticated). It returns a session number.
 * - `subscribed(session)` when the SUBACK for that session grants
 *   the subscription. A SUBACK from an older session is ignored.
 * - `disconnected()` on close, offline or end. Repeated calls while
 *   already disconnected change nothing.
 *
 * The clock starts at construction and restarts each time the client
 * leaves the subscribed state. A connect does not restart it, so a
 * client that keeps connecting and dropping before it subscribes
 * still times out. */
export class ConnectionWatchdog {
    private timeoutMs: number;
    private checkEveryMs: number;
    private onTimeout: (state: ConnectionState, unhealthyMs: number) => void;
    private onChange: (state: ConnectionState, prev: ConnectionState, unhealthyMs: number) => void;
    private now: () => number;
    private _state: ConnectionState = "disconnected";
    private unhealthySince: number;
    private session = 0;
    private timer: ReturnType<typeof setInterval> | null = null;
    private fired = false;

    constructor (opts: ConnectionWatchdogOptions) {
        this.timeoutMs = opts.timeoutMs;
        this.onTimeout = opts.onTimeout;
        this.onChange = opts.onChange ?? (() => {});
        this.now = opts.now ?? Date.now;
        this.checkEveryMs = opts.checkEveryMs
            ?? Math.max(1000, Math.min(30_000, Math.floor(this.timeoutMs / 4)));
        this.unhealthySince = this.now();
    }

    get enabled (): boolean {
        return this.timeoutMs > 0;
    }

    get state (): ConnectionState {
        return this._state;
    }

    /** Milliseconds since the client was last subscribed (or since
     * construction). 0 while subscribed. */
    unhealthyMs (): number {
        return this._state === "subscribed" ? 0 : this.now() - this.unhealthySince;
    }

    private set (state: ConnectionState): void {
        const prev = this._state;
        if (state === prev) return;
        const unhealthy = this.unhealthyMs();
        if (prev === "subscribed")
            this.unhealthySince = this.now();
        this._state = state;
        this.onChange(state, prev, unhealthy);
    }

    /** The client has connected. A new connection has no
     * subscription yet.
     * @returns A session number to pass to `subscribed()`. */
    connected (): number {
        this.session++;
        this.set("connected");
        return this.session;
    }

    /** The broker granted the subscription sent on `session`. */
    subscribed (session: number): void {
        if (session !== this.session || this._state !== "connected")
            return;
        this.set("subscribed");
    }

    /** The client has lost its connection, or has ended. */
    disconnected (): void {
        this.set("disconnected");
    }

    /** Start the periodic check. */
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

    /** Check now. If not subscribed and the timeout has passed, fires
     * `onTimeout` (once) and stops.
     * @returns true if the watchdog fired. */
    check (): boolean {
        if (!this.enabled || this.fired || this._state === "subscribed")
            return false;
        const unhealthy = this.unhealthyMs();
        if (unhealthy < this.timeoutMs) return false;
        this.fired = true;
        this.stop();
        this.onTimeout(this._state, unhealthy);
        return true;
    }
}

/** A log line for a connection state change. `timeoutMs` is the
 * watchdog's timeout (0 if disabled). */
export function describeConnectionChange (
    state: ConnectionState, prev: ConnectionState,
    unhealthyMs: number, timeoutMs: number,
): string {
    const secs = (ms: number) => Math.max(0, Math.round(ms / 1000));
    switch (state) {
        case "disconnected": {
            if (!timeoutMs) return "MQTT disconnected";
            /* Time already spent unsubscribed counts. */
            const left = prev === "subscribed" ? timeoutMs : timeoutMs - unhealthyMs;
            return `MQTT disconnected; exiting in ${secs(left)}s unless connected and subscribed again`;
        }
        case "connected":
            return "MQTT connected; waiting for the broker to grant the subscription";
        case "subscribed":
            return `MQTT connected and subscribed (after ${secs(unhealthyMs)}s without a subscription)`;
    }
}

/** The fatal log line when the connection watchdog fires. */
export function describeConnectionTimeout (
    state: ConnectionState, unhealthyMs: number, timeoutMs: number,
): string {
    const what = state === "connected"
        ? "connected to the MQTT broker, but no subscription has been granted"
        : "not connected to the MQTT broker";
    return `Connection watchdog: ${what} for ${Math.round(unhealthyMs / 1000)}s ` +
        `(CONNECT_TIMEOUT ${timeoutMs / 1000}s). Exiting so the pod is restarted.`;
}
