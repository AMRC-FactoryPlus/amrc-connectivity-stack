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
    #addrsPending: NodeJS.Immediate | null = null

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
        this.#cancel_addrs();
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
        /* An empty poll asks the driver to read nothing. Do not send
         * it. A pending address map can wait: it is only needed ahead
         * of a poll that is actually sent. */
        if (poll == "") return;
        this.#flush_addrs();
        this.broker.publish({
            id:         this.id,
            msg:        "poll",
            payload:    Buffer.from(poll),
        });
    }

    writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat: serialisationType, delimiter?: string) {
        this.#flush_addrs();
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
            this.#queue_addrs();

        /* A device with no addresses has nothing to poll, so do not
         * start a timer that only sends empty polls. */
        if (addrs.length == 0) {
            subscriptionStartCallback();
            return;
        }

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
            /* The driver clears its map on conf, so send the map
             * straight after it, as before. */
            this.#cancel_addrs();
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

    /* Send the address map once the current burst of changes is done.
     * Each device calls startSubscription from its own ready timer, and
     * the map is sent whole, so sending it every time is quadratic in
     * the number of devices. The driver replaces its map on each addr
     * message, so only the last one matters. setImmediate sends once
     * per turn of the event loop, after the timers due in that turn. */
    #queue_addrs () {
        if (this.#addrsPending) return;
        this.#addrsPending = setImmediate(() => {
            this.#addrsPending = null;
            if (this.status != "DOWN")
                this.#send_addrs();
        });
    }

    /* A poll or a cmd must reach the driver after the map it depends
     * on, so send any pending map first. */
    #flush_addrs () {
        if (!this.#addrsPending) return;
        this.#cancel_addrs();
        if (this.status != "DOWN")
            this.#send_addrs();
    }

    #cancel_addrs () {
        if (!this.#addrsPending) return;
        clearImmediate(this.#addrsPending);
        this.#addrsPending = null;
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
