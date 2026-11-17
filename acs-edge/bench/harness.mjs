/*
 * ACS Edge Agent benchmark
 * The real Edge Agent objects, wired up with no broker or cluster
 * Copyright 2026 University of Sheffield
 *
 * This runs the Edge Agent code compiled into
 * node_modules/.cache/edge-bench (see
 * bench/tsconfig.json). The only thing replaced is the MQTT connection
 * to the Factory+ broker: SparkplugNode and the service client's
 * BasicSparkplugNode are real, so every DDATA is built and
 * protobuf-encoded as it is in production, and handed to a fake MQTT
 * connection that only counts it.
 */

import { EventEmitter } from "node:events";

import { Address }              from "@amrc-factoryplus/service-client";
import { BasicSparkplugNode }   from "@amrc-factoryplus/service-client/lib/sparkplug/basic-node.js";

import { Device, DeviceConnection } from "../node_modules/.cache/edge-bench/lib/device.js";
import { SparkplugNode }            from "../node_modules/.cache/edge-bench/lib/sparkplugNode.js";

const NODE_UUID = "6d4c7b0e-3f1a-4c55-9a43-5c7e2a3b9e10";

/* Long enough that no poll timer fires during a run. */
export const POLL_NEVER = 1e9;

/* Stands in for the mqtt.js client BasicSparkplugNode would use. */
class FakeMqtt extends EventEmitter {
    constructor () {
        super();
        this.ddata = 0;
        this.bytes = 0;
        this.waiter = null;
    }

    publish (topic, message) {
        if (!topic.includes("/DDATA/")) return;
        this.ddata++;
        this.bytes += message.length;
        if (this.waiter && this.ddata >= this.waiter.target) {
            const { resolve } = this.waiter;
            this.waiter = null;
            resolve();
        }
    }

    subscribe () { }
    end () { }

    /* Resolves once `target` DDATA messages in total have gone out. */
    until (target) {
        if (this.ddata >= target) return Promise.resolve();
        return new Promise(resolve => this.waiter = { target, resolve });
    }
}

export async function sparkplug_node () {
    const mqtt = new FakeMqtt();
    const fplus = {
        MQTT: {
            basic_sparkplug_node: async opts => new BasicSparkplugNode({
                ...opts,
                mqttFactory: async () => mqtt,
            }),
        },
    };
    const node = new SparkplugNode(fplus, {
        address:    Address.parse("Bench-Group/Bench-Node"),
        uuid:       NODE_UUID,
    });
    await node.init();
    /* BasicSparkplugNode.connect is async and not awaited by init. */
    await new Promise(r => setImmediate(r));
    mqtt.emit("authenticated");
    if (!node.isOnline)
        throw new Error("SparkplugNode did not come online");
    return { node, mqtt };
}

export function device_options (c) {
    return {
        deviceId:       c.name,
        pollInt:        POLL_NEVER,
        pubInterval:    0,
        templates:      [],
        metrics:        structuredClone(c.metrics),
        payloadFormat:  c.payloadFormat,
        delimiter:      c.delimiter ?? "",
    };
}

/* Translator.runDevices hands each connection "data" event to the
 * devices that own its addresses. With one device per connection that
 * is a single _handleData call, which this copies. */
export function route (conn, device) {
    conn.on("data", (obj, parseVals = true) => device._handleData(obj, parseVals));
}

/* A connection that does nothing; the benchmark emits its data events. */
export class BenchConnection extends DeviceConnection {
    constructor () { super("Bench"); }
}

export function make_device (node, conn, c) {
    const dev = new Device(node, conn, device_options(c));
    route(conn, dev);
    return dev;
}

export { Device };
