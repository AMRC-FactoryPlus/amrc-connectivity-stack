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
        this.store = new CassetteStore({
            conf, env: process.env, log: this.log });
        this.player = new Player({
            emit:       (path, value, stamp) =>
                this.publish(path, value, stamp),
            onState:    () => this.publishState(),
            log:        this.log,
        });
    }

    static create (driver, conf) {
        return new SimHandler(driver, conf);
    }

    async connect () {
        return "UP";
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
     * cassette has but the edge agent hasn't asked for are skipped. */
    publish (addr, value, timestamp) {
        const spec = this.specs.get(addr);
        if (!spec) return;
        const buf = Buffer.from(JSON.stringify({ value, timestamp }));
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
        this.player.eject();
    }
}
