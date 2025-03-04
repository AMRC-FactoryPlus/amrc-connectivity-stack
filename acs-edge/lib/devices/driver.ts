/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import {Metrics, serialisationType, writeValToBuffer} from "../helpers/typeHandler.js";
import {log} from "../helpers/log.js";

import {DriverBroker} from "../driverBroker.js";
import {DeviceConnection} from "../device.js";

interface addrGroup {
    poll:   number,
    addrs:  Set<string>,
}

export class DriverConnection extends DeviceConnection {
    id:         string
    conf:       any
    broker:     DriverBroker
    status:     string
    addrs:      Map<string, string>
    topics:     Map<string, string>
    groups:     Map<string, addrGroup>

    constructor(type: string, details: any, name: string, broker: DriverBroker) {
        // Call constructor of parent class
        super(type);
        this.id = name;
        this.conf = details;
        this.broker = broker;

        this.status = "DOWN";
        this.addrs = new Map();
        this.topics = new Map();
        this.groups = new Map();
    }

    open() {
        log(`Opening Driver ${this.id}`);
        this.broker.on("message", this.#message.bind(this));
        this.broker.publish({
            id:         this.id,
            msg:        "active",
            payload:    Buffer.from("ONLINE"),
        });
        /* We do not emit "open" here, we wait for the negotiation with
         * the driver. */
    }

    close () {
        this.broker.publish({
            id:         this.id,
            msg:        "active",
            payload:    Buffer.from("OFFLINE"),
        });
        this.broker.off("message", this.#message.bind(this));
        this.emit("close");
    }



    readMetrics(metrics: Metrics, payloadFormat?: string, delimiter?: string) {
        const poll = metrics.addresses
            .filter(a => this.topics.has(a))
            .map(a => this.topics.get(a))
            .join("\n");
        this.broker.publish({
            id:         this.id,
            msg:        "poll",
            payload:    Buffer.from(poll),
        });
    }

    writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat: serialisationType, delimiter?: string) {
        let err;

        metrics.array.forEach(m => {

            // @ts-ignore
            const foundKey = [...this.addrs.entries()].find(([key, value]) => value === m.properties.address.value)?.[0];
            // @ts-ignore
            const addr = this.addrs.get(foundKey);
            if (!addr) {
                // @ts-ignore
                err = new Error(`Address ${m.properties.address.value} not found`);
                return;
            }

            const payload = writeValToBuffer(m);

            this.broker.publish({
                id:         this.id,
                msg:        "cmd",
                data:       addr,
                payload:    payload,
            });
        });

        // Call the writeCallback when complete, setting the error if
        // necessary
        writeCallback(err);
    }

    /**
     *
     * @param metrics Metrics object to watch
     * @param payloadFormat String denoting the format of the payload
     * @param delimiter String specifying the delimiter character if needed
     * @param interval Time interval between metric reads, in ms
     * @param deviceId The device ID whose metrics are to be watched
     * @param subscriptionStartCallback A function to call once the subscription has been setup
     */
    async startSubscription(metrics: Metrics, payloadFormat: serialisationType, delimiter: string, interval: number, deviceId: string, subscriptionStartCallback: Function) {

        const addrs = metrics.addresses;
        const unassigned = addrs.filter(a => !this.topics.has(a));
        for (const a of unassigned) {
            const dt = this.#newTopic();
            this.addrs.set(dt, a);
            this.topics.set(a, dt);
        }
        const topics = new Set(addrs.map(a => this.topics.get(a)!))
        this.groups.set(deviceId, {
            poll:   interval,
            addrs:  topics,
        });

        if (this.status != "DOWN")
            this.#send_addrs();

        super.startSubscription(metrics, payloadFormat, delimiter, interval,
            deviceId, subscriptionStartCallback);
    }

    /**
     * Stop a previously registered subscription for  metric changes.
     * @param deviceId The device ID we are cancelling the subscription for
     * @param stopSubCallback A function to call once the subscription has been cancelled
     */
    //async stopSubscription(deviceId: string, stopSubCallback: Function) {
    //}

    #newTopic () {
        while (true) {
            const dt = Math.floor(Math.random() * 100000).toString();
            if (!this.addrs.has(dt))
                return dt;
        }
    }

    #message (message) {
        const { id, msg, data, payload } = message;
        if (id != this.id) return;

        //log(util.format("DRIVER message: %s %s", id, msg));
        switch (msg) {
        case "status":  return this.#msg_status(payload.toString());
        case "data":    return this.#msg_data(data, payload);
        case "err":     return this.#msg_err(data, payload.toString());

        /* Our messages are looped */
        case "active":
        case "conf":
        case "addr":
        case "cmd":
        case "poll":
            return;
        }
        log(`Unexpected ${msg} message from ${id}`);
    }

    #msg_status (status: string) {
        const ost = this.status;
        this.status = status;
        log(`DRIVER [${this.id}]: status ${ost} -> ${status}`);

        switch (status) {
        case "READY":
            this.broker.publish({
                id: this.id,
                msg: "conf",
                payload: Buffer.from(JSON.stringify(this.conf)),
            });
            this.#send_addrs();
            break;
        case "UP":
            if (ost != "UP")
                this.emit("open");
            break;
        case "DOWN":
        case "CONF":
        case "CONN":
        case "AUTH":
        case "ERR":
            if (ost == "UP")
                this.emit("close");
            break;
        }
    }

    #send_addrs () {
        const addrs = {
            version: 1,
            addrs:  Object.fromEntries(this.addrs),
            groups: Object.fromEntries(
                [...this.groups.entries()]
                .map(([n, i]) => [n, {
                    poll:   i.poll,
                    addrs:  [...i.addrs],
                }])),
        };
        this.broker.publish({
            id:         this.id,
            msg:        "addr",
            payload:    Buffer.from(JSON.stringify(addrs)),
        });
    }

    #msg_data (data: string, payload: Buffer) {
        const addr = this.addrs.get(data);
        //log(`Driver [${this.id}]: data ${data} ${addr}`);
        if (addr)
            this.emit("data", { [addr]: payload });
    }

    #msg_err (data: string, error: string) { }
}
