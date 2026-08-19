/*
 * ACS simulator driver
 * Edge Agent driver handler.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Presents a cassette player as an ordinary edge device. Data
 * addresses are cassette channel paths; the player's transport is
 * driven by writes (DCMD via cmdesc) to the player:* control
 * addresses. Command addresses must not contain slashes: the edge
 * agent forwards a write as an MQTT message on cmd/<address>, and only
 * the first topic segment survives.
 */

import { CassetteStore } from "./cassette.js";
import { Player, Status } from "./player.js";

const CONTROLS = new Set(
    ["load", "eject", "play", "pause", "stop", "seek", "rate"]);
const STATES = new Set(
    ["status", "cassette", "position", "rate_actual", "error"]);

/* How long to wait for the edge agent to answer a cassette request. */
export const REQUEST_TIMEOUT = 10000;

/* Accept an ISO-8601 string or a ms-epoch number. */
function parseTime (t) {
    if (t == null) return null;
    if (Number.isFinite(t)) return t;
    const ms = Date.parse(t);
    if (Number.isNaN(ms))
        throw new Error(`Bad time: ${t}`);
    return ms;
}

export class SimHandler {
    constructor (driver, conf) {
        this.driver = driver;
        this.log = driver.debug.bound("sim");

        this.specs = new Map();     /* address string -> spec */
        this.pending = new Map();   /* cassette uuid -> {resolve, reject, timer} */
        this.store = new CassetteStore({
            env:        process.env,
            log:        this.log,
            request:    uuid => this.requestCassette(uuid),
        });

        /* Cassette responses from the edge agent. Handlers are keyed
         * by the first topic segment after the driver id, so this
         * receives every rsp/<what> message. */
        driver.message("rsp", (payload, data) =>
            this.rsp(payload, data));
        this.player = new Player({
            emit:       (path, value, stamp) =>
                this.publish(path, value, stamp, this.player.runId),
            onState:    () => this.publishState(),
            log:        this.log,
        });
    }

    static create (driver, conf) {
        return new SimHandler(driver, conf);
    }

    async connect () {
        /* The base class only subscribes to the topics it knows about,
         * so the rsp topic is ours to add. The MQTT connection is up
         * by the time the handler exists (conf arrives over it). */
        await this.driver.mqtt.subscribeAsync(
            this.driver.topic("rsp", "cassette"));
        return "UP";
    }

    /* Ask the edge agent to fetch a cassette from the ConfigDB on our
     * behalf (the agent holds the pod's Factory+ identity). */
    requestCassette (uuid, timeout = REQUEST_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(uuid);
                reject(new Error("timed out waiting for the edge agent"));
            }, timeout);
            this.pending.set(uuid, { resolve, reject, timer });
            this.driver.mqtt.publishAsync(
                    this.driver.topic("req", "cassette"), uuid)
                .catch(e => {
                    clearTimeout(timer);
                    this.pending.delete(uuid);
                    reject(e);
                });
        });
    }

    rsp (payload, data) {
        if (data != "cassette") return;
        let body;
        try { body = JSON.parse(payload.toString()); }
        catch { return this.log("Bad rsp payload from agent"); }

        const req = this.pending.get(body.uuid);
        if (!req) return;
        this.pending.delete(body.uuid);
        clearTimeout(req.timer);

        if (body.error) req.reject(new Error(body.error));
        else req.resolve(body.cassette);
    }

    parseAddr (spec) {
        if (spec.startsWith("player:")) {
            const verb = spec.slice("player:".length);
            if (CONTROLS.has(verb))
                return { addr: spec, ctrl: verb };
            if (STATES.has(verb))
                return { addr: spec, state: verb };
            return;
        }
        /* Anything else is a cassette channel path. */
        return { addr: spec, path: spec };
    }

    async subscribe (specs) {
        this.specs = new Map(specs.map(s => [s.addr, s]));
        this.publishState();
        return true;
    }

    /* Publish one value to a subscribed address. Addresses the current
     * cassette has but the edge agent hasn't asked for are skipped.
     * Every payload from this driver is marked simulated; replayed
     * samples also carry the run id minted at Play, so the historians
     * can tag the data and a mistaken run can be found and removed. */
    publish (addr, value, timestamp, runId) {
        const spec = this.specs.get(addr);
        if (!spec) return;
        const payload = { value, timestamp, simulated: true };
        if (runId) payload.run_id = runId;
        const buf = Buffer.from(JSON.stringify(payload));
        this.driver.data(spec, buf);
    }

    publishState () {
        const st = this.player.state();
        const now = Date.now();
        this.publish("player:status", st.status, now);
        this.publish("player:cassette", st.cassette ?? "", now);
        this.publish("player:position", st.position, now);
        this.publish("player:rate_actual", st.rate, now);

        /* Keep position fresh while playing. */
        if (st.status == Status.PLAYING)
            this.poller ??= setInterval(() => {
                this.player.tick();
                const s = this.player.state();
                this.publish("player:position", s.position, Date.now());
            }, 1000);
        else if (this.poller) {
            clearInterval(this.poller);
            this.poller = null;
        }
    }

    error (msg) {
        this.log("ERROR: %s", msg);
        this.publish("player:error", msg, Date.now());
    }

    /* A DCMD write forwarded by the edge agent. The payload is the
     * raw written value; we accept JSON or a bare string. */
    async cmd (command, data) {
        const raw = data.toString().trim();
        let value = raw;
        try { value = JSON.parse(raw); } catch { /* bare string */ }

        try {
            await this.#dispatch(command, value);
        }
        catch (e) {
            this.error(`${command}: ${e.message}`);
        }
    }

    async #dispatch (command, value) {
        const { player } = this;
        switch (command) {
        case "player:load": {
            const cassette = await this.store.fetch(String(value));
            cassette.cassette.uuid ??= String(value);
            player.load(cassette);
            this.log("Loaded cassette %s (%s ms, %s channels)",
                cassette.cassette.name, cassette.cassette.duration_ms,
                cassette.channels.length);
            break;
        }
        case "player:eject":
            player.eject();
            break;
        case "player:play": {
            const opts = typeof value == "object" && value != null
                ? value : {};
            player.play({
                start_time: parseTime(opts.start_time),
                rate:       opts.rate ?? null,
                loop:       !!opts.loop,
            });
            break;
        }
        case "player:pause":
            player.pause();
            break;
        case "player:stop":
            player.stop();
            break;
        case "player:seek": {
            const pos = typeof value == "object" && value != null
                ? value.position_ms : Number(value);
            player.seek(pos);
            break;
        }
        case "player:rate":
            player.setRate(Number(value));
            break;
        default:
            throw new Error("unknown command");
        }
    }

    async close () {
        if (this.poller) clearInterval(this.poller);
        for (const req of this.pending.values()) {
            clearTimeout(req.timer);
            req.reject(new Error("driver closing"));
        }
        this.pending.clear();
        this.player.eject();
    }
}
