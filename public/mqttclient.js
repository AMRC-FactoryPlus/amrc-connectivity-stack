/*
 * Factory+ visualiser.
 * MQTT client.
 * Copyright 2022 AMRC.
 */

import { EventEmitter, MQTT } from "./webpack.js";

export default class MQTTClient extends EventEmitter {
    constructor (opts) {
        super();
        this.broker = opts.broker;
        this.username = opts.username;
        this.password = opts.password;

        this.known = new Set();
        this.graph = {
            name: opts.name,
        };
    }

    run () {
        const mqtt = this.mqtt = MQTT.connect(this.broker, {
            username: this.username,
            password: this.password,
        });

        mqtt.on("connect", () => console.log("MQTT connected"));
        mqtt.on("error", e => console.log(`MQTT error: ${e}`));
        mqtt.on("message", this.on_message.bind(this));

        mqtt.subscribe("spBv1.0/#");

        return this;
    }

    stop () {
        return new Promise((resolve, reject) => {
            this.mqtt.on("end", resolve);
            this.mqtt.end();
        });
    }

    on_message (topic, message) {
        const match = topic.match(
            // Please, please, can I have m!!x back... ?
            /^spBv1\.0\/([\w-]+)\/[ND]([A-Z]+)\/([\w -]+)(?:\/([\w -]+))?$/);
        if (!match) {
            console.log(`Bad MQTT topic ${topic}`);
            return;
        }

        const [, group, kind, node, device] = match;

        const parts = [...group.split("-"), node];
        if (device != undefined) parts.push(device);
        const path = parts.join("/");

        this.add_to_graph(parts, path);

        this.emit("packet", path, kind);
    }

    add_to_graph (parts, path) {
        if (this.known.has(path)) return;
        this.known.add(path);

        let node = this.graph;

        for (const p of parts) {
            const children = node.children ??= [];
            let next = children.find(c => c.name == p);
            if (!next) {
                next = { name: p };
                children.push(next);
            }
            node = next;
        }
        node.path = path;

        this.emit("graph");
    }
}

