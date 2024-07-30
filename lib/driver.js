/* AMRC Connectivity Stack
 * Edge Agent driver library
 * Copyright 2024 AMRC
 */

import MQTT from "mqtt";

import { Debug } from "./debug.js";

export class Driver {
    constructor (opts) {
        this.createHandler = opts.handler;

        this.status = "DOWN";
        this.addrs = null;

        const { env } = opts;
        this.debug = new Debug({ verbose: env.VERBOSE });
        this.log = this.debug.bound("driver");

        this.id = env.EDGE_USERNAME;
        this.mqtt = this.createMqttClient(env.EDGE_MQTT, env.EDGE_PASSWORD);

        /* Overwrite this in a subclass to request driver polling */
        this.poller = null;
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
        const mqtt = MQTT.connect({
            url:            broker,
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

    setStatus (st) {
        this.status = st;
        if (this.mqtt.connected)
            this.mqtt.publish(this.topic("status"), st);
    }

    setAddrs (pkt) {
        if (!this.handler) {
            this.log("Received addrs without handler");
            return false;
        }

        if (pkt.version != 1) {
            this.log("Bad addr config version: %s", pkt.version);
            return false;
        }
        
        const parsed = Object.entries(pkt.addrs)
            .map(([t, a]) => [t, this.handler.parseAddr(a)]);

        if (parsed.some(([, f]) => !f)) {
            this.log("BAD ADDRS: %O", pkt.addrs);
            return false;
        }
        
        this.addrs = new Map(parsed);
        this.log("Set addrs: %O", this.addrs);
        return true;
    }

    async connected () {
        const topics = [
            ...("active conf addr".split(" ")),
            ...(this.poller ? ["poll"] : []),
        ].map(t => this.topic);
        await this.mqtt.subscribeAsync(topics);
        this.setStatus("READY");
    }

    async handleMessage (topic, p) {
        const [, , msg] = topic.split("/");
        switch (msg) {
            case "active": {
                if (p.toString() == "ONLINE")
                    this.setStatus("READY");
                break;
            }
            case "conf": {
                const conf = this.json(p);
                this.log("CONF: %O", conf);

                this.addrs = null;
                await this.handler?.close?.();

                this.handler = conf && this.createHandler(this, conf);
                if (!this.handler)
                    this.setStatus("CONF");
                break;
            }
            case "addr": {
                const a = this.json(p);
                if (!a || !await this.setAddrs(a))
                    this.setStatus("ADDR");
                break;
            }
            case "poll": {
                const poll = p.toString().split("\n");
                this.log("POLL %O", poll);

                if (!this.poller) {
                    this.log("Can't poll, no poller!");
                    return;
                }
                if (!this.addrs) {
                    this.log("Can't poll, no addrs!");
                    return;
                }
                poll.map(t => ({
                        data: this.topic("data", t),
                        spec: this.addrs.get(t),
                    }))
                    .filter(v => v.spec)
                    .forEach(this.poller);
                break;
            }
        }
    }
}
