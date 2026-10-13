/*
 * Factory+ NodeJS Utilities
 * Watchdog for an MQTT client that has stopped trying to connect.
 * Copyright 2026 University of Sheffield AMRC
 */

/* A service whose MQTT client gives up keeps running, serving HTTP,
 * with no MQTT connection, and nothing restarts it. MQTT.js 5.16 gives
 * up for good after the broker refuses a connection unless told
 * otherwise, and other bugs may find other ways to stop it.
 *
 * This watchdog exits the process if the client has had no connection
 * for the timeout and has made no attempt to connect in that time.
 * Kubernetes then restarts the service with a fresh client.
 *
 * A client that keeps trying is left alone however long the broker is
 * down. Restarting it would not bring the broker back, and would take
 * the service's HTTP API down too. Each early exit also lengthens
 * Kubernetes' restart back-off, so a core service could still be
 * waiting to start long after the broker came back. */

/** Parse a watchdog timeout.
 *
 * The value is a whole number of seconds, as a number or a string.
 * Unset, empty or 0 disables the watchdog. Anything else throws, so a
 * typo cannot quietly turn the watchdog off.
 *
 * @arg value The timeout.
 * @returns The timeout in milliseconds, or 0 if disabled.
 */
export function parse_timeout (value) {
    const str = String(value ?? "").trim();
    if (str == "")
        return 0;
    if (!/^\d+$/.test(str))
        throw new Error(`MQTT_WATCHDOG_TIMEOUT must be a whole number of seconds (0 disables), got "${value}"`);
    return Number.parseInt(str, 10) * 1000;
}

/** Fire a callback if an MQTT client stops trying to connect. */
export class MQTTWatchdog {
    /** Construct a watchdog. Call `start` to begin watching.
     *
     * The clock starts now, and restarts whenever the client loses a
     * connection or starts a reconnect attempt. The callback fires if
     * the clock reaches the timeout while the client is not connected.
     *
     * @arg mqtt The MQTT client, from `mqtt_client`.
     * @arg timeout The timeout in milliseconds.
     * @arg on_stuck Called once, with the milliseconds since the client
     * last lost a connection or tried to connect.
     * @arg now A clock, for tests.
     */
    constructor (opts) {
        this.mqtt = opts.mqtt;
        this.timeout = opts.timeout;
        this.on_stuck = opts.on_stuck;
        this.now = opts.now ?? Date.now;

        this.connected = false;
        this.last = this.now();
        this.timer = null;
    }

    start () {
        const { mqtt } = this;
        const seen = () => this.last = this.now();

        /* Not "connect": with GSSAPI that comes before the server has
         * authenticated itself. */
        mqtt.on("authenticated", () => this.connected = true);
        mqtt.on("close", () => {
            this.connected = false;
            seen();
        });
        mqtt.on("reconnect", seen);
        /* The client has been closed on purpose. */
        mqtt.on("end", () => this.stop());

        const every = Math.max(1000,
            Math.min(30000, Math.floor(this.timeout / 4)));
        this.timer = setInterval(() => this.check(), every);
        /* Don't hold the process open just for the watchdog. */
        this.timer.unref?.();
        return this;
    }

    stop () {
        clearInterval(this.timer);
        this.timer = null;
    }

    /** Check now, and fire if the client is stuck.
     * @returns true if the watchdog fired. */
    check () {
        if (!this.timer || this.connected)
            return false;
        const idle = this.now() - this.last;
        if (idle < this.timeout)
            return false;
        this.stop();
        this.on_stuck(idle);
        return true;
    }
}
