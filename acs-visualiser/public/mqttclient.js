/*
 * Factory+ visualiser.
 * MQTT client.
 * Copyright 2022 AMRC.
 */

import { Address, Topic, EventEmitter, MQTT, SpB } from "./webpack.js";

const FactoryPlus = "11ad7b32-1d32-4c4a-b0c9-fa049208939a";

export default class MQTTClient extends EventEmitter {
    constructor (opts) {
        super();
        this.fplus = opts.fplus;
        this.graph = opts.graph;

        this.known = new Map();

        this.utf8decoder = new TextDecoder();
    }

    static graph (name) {
        return {
            name,
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
        if (!this.mqtt) return;
        return new Promise((resolve, reject) => {
            this.mqtt.on("end", resolve);
            this.mqtt.end();
        });
    }

    on_message (topicstr, message) {
        const topic = Topic.parse(topicstr);
        if (!topic) {
            console.log(`Bad MQTT topic ${topic}`);
            return;
        }

        const { address, type: kind } = topic;
        const { group, node, device } = address;

        const parts = [...group.split("-"), node];
        if (device != undefined) parts.push(device);
        
        const graph = this.add_to_graph(parts);
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
        if (kind == "DATA") {
            this.check_directory(address, graph);
        }
        if (kind == "CMD" && !graph.seen_data) {
            graph.expires = Date.now() + 20*1000;
        }
        else {
            graph.seen_data = true;
            delete graph.expires;
        }
        if (kind == "CMD") {
            const sender = this.find_sender(message);
            const from_parts = [...parts, sender];
            const cmd_from = this.add_to_graph(from_parts);
            cmd_from.expires = Date.now() + 7.5*1000;
            cmd_from.is_cmd = true;
            this.emit("packet", cmd_from.path, kind, true);
        }
        else {
            this.emit("packet", graph.path, kind, false);
        }
    }

    add_to_graph (parts) {
        const path = parts.join("/");

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
        node.seen_birth = true;

        const payload = SpB.decodePayload(message);
        if (payload.uuid != FactoryPlus)
            return;

        const schema = payload.metrics
            .find(m => m.name == "Schema_UUID")
            ?.value;

        //console.log("Found schema %s for %s", schema, node.name);
        node.schema = schema;
        this.emit("schema", schema);
    }

    find_sender (message) {
        const payload = SpB.decodePayload(message);
        if (payload.uuid != FactoryPlus)
            return '';
        const decoded = this.utf8decoder.decode(payload.body);
        const node_name = decoded.split(':')
        return node_name[1];
    }

    async check_directory (address, node) {
        if (node.seen_birth || node.checked_directory)
            return;
        node.checked_directory = true;

        const dir = this.fplus.Directory;

        const [st, rv] = await dir.fetch(`v1/address/${address}`);
        if (st != 200) return;
        const info = await dir.get_device_info(rv.uuid);
        
        if (!info.top_schema) return;
        if (node.seen_birth) return;
        
        node.schema = info.top_schema;
        this.emit("schema", node.schema);
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

