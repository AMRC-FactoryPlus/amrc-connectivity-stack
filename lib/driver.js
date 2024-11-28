/* AMRC Connectivity Stack
 * Edge Agent driver library
 * Copyright 2024 AMRC
 */

import timers from "timers/promises";

import MQTT from "mqtt";

import { Debug } from "./debug.js";

/* Permitted status returns from Handler.connect */
const CONNECT_STATUS = new Set(["UP", "CONN", "AUTH"]);

export class Driver {
    constructor (opts) {


        this.HandlerClass = opts.handler;

        this.status = "DOWN";
        this.clearAddrs();

        const { env } = opts;
        this.debug = new Debug({ verbose: env.VERBOSE });
        this.log = this.debug.bound("driver");

        this.id = env.EDGE_USERNAME;
        this.mqtt = this.createMqttClient(env.EDGE_MQTT, env.EDGE_PASSWORD);

        this.messageHandlers = new Map();
        this.setupMessageHandlers();

        /* Handler reconnect timeout. This can be changed by the
         * handler. */
        this.reconnect = 5000;
        this.reconnecting = false;
    }

    run () {
        this.mqtt.connect();
    }

    topic (msg, data) {
        return `fpEdge1/${this.id}/${msg}` + (data ? `/${data}` : "");
    }

    json (buf) {
        try {
            return JSON.parse(buf.toString());
        }
        catch (e) {
            this.log("JSON parse error: %s", e);
            return;
        }
    }

    createMqttClient (broker, password) {
        const mqtt = MQTT.connect(broker, {
            clientId:       this.id,
            username:       this.id,
            password:       password,
            will:           {
                topic:      this.topic("status"),
                payload:    "DOWN",
            },
            manualConnect:  true,
            resubscribe:    false,
        });

        mqtt.on("connect", () => this.connected());
        mqtt.on("message", (t, p) => this.handleMessage(t, p));

        return mqtt;
    }

    setupHandler (conf) {
        if (!conf) return;

        this.handler = this.HandlerClass.create(this, conf);
        if (!this.handler) return;

        const valid = this.handler.constructor.validAddrs;
        const parse = this.handler.parseAddr ?? (a => a);

        this.handleAddrs = addrs => {
            const entries = Object.entries(addrs);

            if (valid) {
                const bad = entries.filter(([, a]) => !valid.has(a));
                if (bad.length) {
                    this.log("Invalid addresses: %o", bad);
                    return;
                }
            }

            const parsed = entries.map(([t, a]) => [t, parse(a)]);
            const bad = parsed.filter(([, s]) => !s)
                .map(([t, ]) => addrs[t]);

            if (bad.length) {
                this.log("Invalid addresses: %o", bad);
                return;
            }
            return parsed;
        };

        return true;
    }

    setStatus (st) {
        this.status = st;
        if (this.mqtt.connected)
            this.mqtt.publish(this.topic("status"), st);
    }

    async connectHandler () {
        this.log("Connecting handler");
        const pr = this.handler.connect();

        this.subscribe()

        /* If the handler doesn't return a Promise, it wants to use
         * callbacks. */
        if (!pr) return;

        /* If we get a promise (or a plain string), await it and set our
         * status. */
        const st = await pr;
        if (CONNECT_STATUS.has(st))
            this.setStatus(st);
        else
            this.log("Handler.connect returned invalid value: %o", st);

        if (st != "UP")
            this.reconnectHandler();

    }

    connUp () {
        this.setStatus("UP");
    }
    connFailed () {
        this.setStatus("CONN");
        this.reconnectHandler();
    }
    connUnauth () {
        this.setStatus("AUTH");
        this.reconnectHandler();
    }

    async reconnectHandler () {
        if (this.reconnecting) {
            this.log("Handler already reconnecting");
            return;
        }

        this.reconnecting = true;
        this.log("Handler disconnected");
        await timers.setTimeout(this.reconnect);
        this.reconnecting = false;
        this.connectHandler();
    }

    clearAddrs () {
        this.addrs = null;
        this.topics = null;
    }

    async setAddrs (pkt) {
        if (!this.handler) {
            this.log("Received addrs without handler");
            return false;
        }

        /* Until we have resubscribed we have no addrs */
        this.clearAddrs();

        if (pkt.version != 1) {
            this.log("Bad addr config version: %s", pkt.version);
            return false;
        }

        const parsed = this.handleAddrs(pkt.addrs);
        if (!parsed) return false;


        this.addrs = new Map(parsed);
        this.topics = new Map(parsed.map(([t, s]) => [s, t]));
        this.log("Set addrs: %O", this.addrs);

        this.subscribe()

        return true;
    }

    async subscribe () {
        const { handler } = this;

        // Check if status is UP
        if (this.status !== "UP") {
            this.log("Handler not UP");
            return false;
        }

        if (!this.addrs) {
            this.log("Addresses not configured or none available");
            return false;
        }

        const specs = [...this.addrs.values()].map(([, s]) => s);

        if (handler.subscribe) {
            if (!await handler.subscribe(specs)) {
                this.log("Handler subscription failed");
                return false;
            }
        }

        return true;
    }

    async connected () {
        const topics = [...this.messageHandlers.keys()]
            .map(t => this.topic(t));
        await this.mqtt.subscribeAsync(topics);
        this.setStatus("READY");
    }

    handleMessage (topic, p) {
        const [, , msg, data] = topic.split("/");

        const h = this.messageHandlers.get(msg);
        if (!h) {
            this.log("Unhandled driver message: %s", msg);
            return;
        }

        h(p, data);
    }

    message (msg, handler) {
        this.messageHandlers.set(msg, handler);
    }

    /* Override this method to change the message handlers we use */
    setupMessageHandlers () {
        this.message("active", p => {
            if (p.toString() == "ONLINE")
                this.setStatus("READY");
        });
        this.message("conf", async p => {
            const conf = this.json(p);
            this.log("CONF: %O", conf);

            this.clearAddrs();
            const old = this.handler;

            if (this.setupHandler(conf)) {
                const closer = old?.close;
                if (closer) {
                    /* Support both Promise and callback APIs */
                    await new Promise(resolve => {
                        const pr = closer.call(old, resolve);
                        if (pr) resolve(pr);
                    });
                }
                this.connectHandler()
            }
            else {
                this.setStatus("CONF");
            }
        });
        this.message("addr", async p => {
            const a = this.json(p);
            if (!a || !await this.setAddrs(a))
                this.setStatus("ADDR");
        });
    }
}
