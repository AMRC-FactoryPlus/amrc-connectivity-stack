/*
 * Factory+ visualiser.
 * MQTT client.
 * Copyright 2022 AMRC.
 */

import { EventEmitter, MQTT, SpB } from "./webpack.js";

const FactoryPlus = "11ad7b32-1d32-4c4a-b0c9-fa049208939a";

export default class MQTTClient extends EventEmitter {
    constructor (opts) {
        super();
        this.fplus = opts.fplus;
        this.icons = opts.icons;

        this.known = new Map();
        this.graph = {
            name: opts.name,
            online: true,
        };
    }

    async run () {
        const mqtt = this.mqtt = await this.fplus.MQTT.mqtt_client();

        mqtt.on("connect", () => console.log("MQTT connected"));
        mqtt.on("error", e => console.log(`MQTT error: ${e}`));
        mqtt.on("message", this.on_message.bind(this));

        mqtt.subscribe("spBv1.0/#");

        this.expiry_timer = setInterval(() => this.on_expiry(), 3000);
    }

    stop () {
        clearInterval(this.expiry_timer);
        return new Promise((resolve, reject) => {
            this.mqtt.on("end", resolve);
            this.mqtt.end();
        });
    }

    on_message (topic, message) {
        const match = topic.match(
            // Please, please, can I have m!!x back... ?
            /^spBv1\.0\/([\w.-]+)\/[ND]([A-Z]+)\/([\w. -]+)(?:\/([\w. -]+))?$/);
        if (!match) {
            console.log(`Bad MQTT topic ${topic}`);
            return;
        }

        const [, group, kind, node, device] = match;

        const parts = [...group.split("-"), node];
        if (device != undefined) parts.push(device);
        const path = parts.join("/");

        const graph = this.add_to_graph(parts, path);
        if (kind == "BIRTH" || kind == "DATA") {
            for (let g = graph; g; g = g.parent)
                g.online = true;
        }
        if (kind == "DEATH") {
            graph.online = false;
            graph.children?.forEach(c => c.online = false);
        }
        if (kind == "BIRTH") {
            this.check_for_schema(message, graph);
        }
        if (kind == "CMD" && !graph.seen_data) {
            graph.expires = Date.now() + 20*1000;
        }
        else {
            graph.seen_data = true;
            delete graph.expires;
        }

        this.emit("packet", path, kind);
    }

    add_to_graph (parts, path) {
        if (this.known.has(path))
            return this.known.get(path);

        let node = this.graph;

        for (const p of parts) {
            const children = node.children ??= [];
            let next = children.find(c => c.name == p);
            if (!next) {
                next = { parent: node, name: p, online: false };
                children.push(next);
            }
            node = next;
        }
        node.path = path;
        this.known.set(path, node);

        this.emit("graph");
        return node;
    }

    check_for_schema (message, node) {
        const payload = SpB.decodePayload(message);
        if (payload.uuid != FactoryPlus)
            return;

        const schema = payload.metrics
            .find(m => m.name == "Schema_UUID")
            ?.value;

        //console.log("Found schema %s for %s", schema, node.name);
        node.schema = schema;
        this.icons.request_icon(schema);
    }

    on_expiry () {
        const now = Date.now();
        const changed = [false];
        this.check_expiry(now, this.graph, changed);
        if (changed[0])
            this.emit("graph");
    }

    check_expiry (now, node, changed) {
        if (!node.children) return;
        node.children = node.children.filter(kid => {
            this.check_expiry(now, kid, changed);
            const ok = !kid.expires || kid.expires > now;
            if (!ok) {
                changed[0] = true;
                this.known.delete(kid.path);
            }
            return ok;
        });
        if (!node.children.length && !node.seen_data)
            node.expires = now;
    }
}   

