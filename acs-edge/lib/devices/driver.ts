/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import {Metrics, serialisationType, sparkplugMetric, writeValToBuffer, writeValToJSON} from "../helpers/typeHandler.js";
import {log} from "../helpers/log.js";

import {DriverBroker} from "../driverBroker.js";
import {DeviceConnection} from "../device.js";

/* Whether an address can go in a cmd or write topic. MQTT forbids the
 * wildcards and NUL in a topic name. */
export function cmd_addressable (addr: string) {
    return !/[+#\0]/.test(addr);
}

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
            /* A write goes to cmd/<address> and write/<address>, not to
             * the data topic, because every published driver library
             * takes the address from the topic. The address is the
             * whole rest of the topic, so it may contain "/", but it
             * can't contain the MQTT wildcards or NUL. See
             * docs/edge-split.md. */
            const addr = m.properties?.address?.value as string | undefined;
            if (!addr || !this.topics.has(addr)) {
                err = new Error(`Address ${addr} not found`);
                return;
            }
            if (!cmd_addressable(addr)) {
                err = new Error(`Address ${addr} can't be written: it contains + # or NUL`);
                return;
            }

            const e = this.#write_metric(addr, m);
            if (e) err = e;
        });

        // Call the writeCallback when complete, setting the error if
        // necessary
        writeCallback(err);
    }

    /* Send one write in both forms. A driver subscribes to the form it
     * understands, so the agent doesn't need to know which: cmd/ is
     * the value as raw bytes, as drivers have always had it, and
     * write/ is JSON with the Sparkplug type. A form that can't carry
     * this value is left out. Returns an error only if neither can. */
    #write_metric (addr: string, m: sparkplugMetric): Error | undefined {
        const forms: Array<[string, (m: sparkplugMetric) => Buffer]> = [
            ["cmd", writeValToBuffer],
            ["write", writeValToJSON],
        ];
        const errs: string[] = [];

        for (const [msg, encode] of forms) {
            let payload: Buffer;
            try {
                payload = encode(m);
            }
            catch (e) {
                errs.push(`${msg}: ${(e as Error).message}`);
                continue;
            }
            this.broker.publish({ id: this.id, msg, data: addr, payload });
        }

        if (errs.length == 0) return;
        const why = `Can't write ${m.name} to ${addr}: ${errs.join(", ")}`;
        if (errs.length < forms.length) {
            log(`DRIVER [${this.id}]: ${why}`);
            return;
        }
        return new Error(why);
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
        case "write":
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

    /* A driver reports a problem with an address, such as a failed
     * write, as an error code, optionally followed by a newline and a
     * message. Nothing acts on it yet, so log it. This goes to the
     * console rather than the debug log because an operator needs to
     * see a failed write. */
    #msg_err (data: string, error: string) {
        const addr = this.addrs.get(data) ?? `data topic ${data}`;
        const [code, ...rest] = error.split("\n");
        const msg = rest.join("\n").trim();
        if (code == "")
            console.log(`DRIVER [${this.id}]: error cleared on ${addr}`);
        else
            console.log(`DRIVER [${this.id}]: error ${code} on ${addr}` + (msg ? `: ${msg}` : ""));
    }
}
