/* AMRC Connectivity Stack
 * Edge Agent driver library
 * Copyright 2024 AMRC
 */

import asyncjs from "async";
import MQTT from "mqtt";

const Q_TIMEOUT = 30000;
const Q_MAX = 20;

export class PolledDriver {
    constructor (opts) {
        this.createHandler = opts.handler;

        this.status = "DOWN";
        this.addrs = null;

        const { env } = opts;
        this.id = env.EDGE_USERNAME;
        this.mqtt = this.createMqttClient(env.EDGE_MQTT, env.EDGE_PASSWORD);

        const do_poll = asyncjs.timeout(this.poll.bind(this), Q_TIMEOUT);
        if (opts.serial)
            this.poller = this.createPollQueue(do_poll);
        else
            this.poller = a => do_poll(a, e => e && this.pollErr(e));
    }

    run () {
        this.mqtt.connect();
    }

    topic (msg, data) {
        return `fpEdge1/${this.id}/${msg}` + (data ? `/${data}` : "");
    }

    createMqttClient (broker, password) {
        const mqtt = MQTT.connect({
            url:            process.env.EDGE_MQTT,
            clientId:       this.id,
            username:       this.id,
            password:       process.env.EDGE_PASSWORD,
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

    createPollQueue (do_poll) {
        const q = asyncjs.queue(do_poll);
        q.error(this.pollErr.bind(this));

        return a => q.push(a);
    }

    pollErr (e) {
        console.log("POLL ERR: %o", e);
    }

    setStatus (st) {
        this.status = st;
        if (this.mqtt.connected)
            this.mqtt.publish(this.topic("status"), st);
    }

    setAddrs (pkt) {
        if (!this.handler) {
            console.log("Received addrs without handler");
            return false;
        }

        if (pkt.version != 1) {
            console.log("Bad addr config version: %s", pkt.version);
            return false;
        }
        
        const parsed = Object.entries(pkt.addrs)
            .map(([t, a]) => [t, this.handler.parseAddr(a)]);

        if (parsed.some(([, f]) => !f)) {
            console.log("BAD ADDRS: %O", pkt.addrs);
            return false;
        }
        
        this.addrs = new Map(parsed);
        console.log("Set addrs: %O", this.addrs);
        return true;
    }

    async poll ({ data, spec }) {
        console.log("READ %O", spec);
        const buf = await this.handler.poll(spec);

        console.log("DATA %O", buf);
        if (buf)
            await this.mqtt.publishAsync(data, buf);
    }

    async connected () {
        await this.mqtt.subscribeAsync(
            "active conf addr poll"
                .split(" ")
                .map(t => this.topic(t)));
        this.setStatus("READY");
    }

    async handleMessage (topic, p) {
        const [, , msg, data] = topic.split("/");
        switch (msg) {
        case "active":
            if (p.toString() == "ONLINE")
                this.setStatus("READY");
            break;

        case "conf":
            const conf = JSON.parse(p.toString());
            console.log("CONF: %O", conf);
            this.addrs = null;
            this.handler = this.createHandler(this, conf);
            if (this.handler)
                this.handler.run();
            else
                this.setStatus("CONF");
            break;

        case "addr":
            const a = JSON.parse(p.toString());
            if (!this.setAddrs(a))
                this.setStatus("CONF");
            break;

        case "poll":
            const poll = p.toString().split("\n");
            console.log("POLL %O", poll);
            if (this.addrs)
                poll.map(t => ({
                        data: this.topic("data", t),
                        spec: this.addrs.get(t),
                    }))
                    .filter(v => v.spec)
                    .forEach(this.poller);
            else
                console.log("Can't poll, no addrs!");
            break;
        }
    }
}
