/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import crypto from "crypto";

import {Metrics, now_ns, serialisationType, sparkplugMetric, writeValToBuffer, writeValToJSON} from "../helpers/typeHandler.js";
import {log} from "../helpers/log.js";

import {DriverBroker} from "../driverBroker.js";
import {DataGroup, DeviceConnection} from "../device.js";

/* Whether an address can go in a cmd or write topic. MQTT forbids the
 * wildcards and NUL in a topic name. */
export function cmd_addressable (addr: string) {
    return !/[+#\0]/.test(addr);
}

interface addrGroup {
    poll:   number,
    addrs:  Set<string>,
}

/* A write the agent is waiting for the driver to answer. */
interface pendingWrite {
    addr:       string,
    metric:     sparkplugMetric,
    timer:      NodeJS.Timeout,
    callback:   Function,
}

/* How long the agent waits for a driver to answer a write before it
 * gives up and doesn't report the value. DRIVER_WRITE_TIMEOUT
 * overrides it, in milliseconds. */
const WRITE_TIMEOUT = 10_000;

function write_timeout () {
    const ms = Number.parseInt(process.env.DRIVER_WRITE_TIMEOUT ?? "", 10);
    return ms > 0 ? ms : WRITE_TIMEOUT;
}

/* How long, in milliseconds, the agent may hold a driver's data to
 * gather values that arrive together, so that each device publishes
 * one DDATA for them rather than one per value. A driver writes each
 * value to its socket on its own, and an idle agent wakes for the
 * first, so without a wait one OPC UA notification went out as up to
 * 4 DDATA. 10 ms brings a notification of 66 or 1,000 values back to
 * one DDATA (1.00 to 1.10) on one CPU or half of one, and holds a lone
 * value about 12 ms (15 ms at p99). 0 holds nothing past the current
 * turn of the event loop. DRIVER_DATA_WAIT_MS overrides it, up to MAX_DATA_WAIT.
 * See "Gathering data" in docs/edge-split.md. */
const DATA_WAIT = 10;
const MAX_DATA_WAIT = 100;

function data_wait () {
    const ms = Number.parseFloat(process.env.DRIVER_DATA_WAIT_MS ?? "");
    return ms >= 0 ? Math.min(ms, MAX_DATA_WAIT) : DATA_WAIT;
}

/* The features key of every addr packet. */
export const DRIVER_FEATURES = { scout: 1 };

export class DriverConnection extends DeviceConnection {
    id:         string
    conf:       any
    broker:     DriverBroker
    status:     string
    /* When the driver last went UP, in ms, or null while it isn't. */
    up_since:   number | null = null
    addrs:      Map<string, string>
    topics:     Map<string, string>
    groups:     Map<string, addrGroup>
    #addrsPending: NodeJS.Immediate | null = null
    /* Writes waiting for an answer, by write id. The random prefix
     * means an answer meant for an earlier agent can't match. */
    #pending:   Map<string, pendingWrite> = new Map()
    #writeBase  = crypto.randomBytes(4).toString("hex")
    #writeSeq   = 0
    #writeTimeout = write_timeout()
    /* Data messages not yet handed to the devices, by address, and when
     * each arrived. Null-prototype objects, because an address can be
     * any string, "__proto__" included. */
    #data:      { [addr: string]: Buffer } = Object.create(null)
    #received:  DataGroup["received"] = Object.create(null)
    #dataCount  = 0
    #dataTimer: NodeJS.Immediate | NodeJS.Timeout | null = null
    #dataWait   = data_wait()
    #onMessage  = this.#message.bind(this)
    #nextTopic  = Math.floor(Math.random() * 100000)

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
        this.broker.on("message", this.#onMessage);
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
        /* The devices have stopped by now (Translator.stop), so data
         * still waiting has nowhere to go. */
        this.#drop_data();
        /* The device is stopping, so nothing is waiting for these. */
        for (const w of this.#pending.values())
            clearTimeout(w.timer);
        this.#pending.clear();
        this.broker.publish({
            id:         this.id,
            msg:        "active",
            payload:    Buffer.from("OFFLINE"),
        });
        this.broker.off("message", this.#onMessage);
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
        /* A write can report its value straight away. Data that arrived
         * before it must be reported first, as it was when each message
         * was handled on arrival. */
        this.#flush_data();

        /* A driver that subscribed to write/# answers each write, so
         * report each value only when its answer says it was written.
         * Any other driver gets the writes exactly as it always has. */
        if (this.broker.confirms_writes?.(this.id))
            return this.#write_confirmed(metrics, writeCallback);

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

    /* Write each metric to a driver that answers writes. The callback
     * gets (err, written) once per metric: written is the metric when
     * the driver says it was written, and empty, with an error, when
     * the write failed, was refused or got no answer in time. The
     * device then reports only the written values. */
    #write_confirmed (metrics: Metrics, callback: Function) {
        for (const m of metrics.array) {
            const addr = m.properties?.address?.value as string | undefined;
            const fail = (why: string) => callback(
                new Error(`Write of ${m.name} to ${addr} failed: ${why}. The value was not reported.`),
                []);

            if (!addr || !this.topics.has(addr)) {
                fail("the address is not in the address map");
                continue;
            }
            if (!cmd_addressable(addr)) {
                fail("the address contains + # or NUL");
                continue;
            }

            const id = `${this.#writeBase}_${++this.#writeSeq}`;
            const e = this.#write_metric(addr, m, id);
            if (e) {
                fail(e.message);
                continue;
            }

            const timer = setTimeout(() => {
                this.#pending.delete(id);
                fail(`the driver didn't answer within ${this.#writeTimeout} ms`);
            }, this.#writeTimeout);
            const answer = (err?: string) => err === undefined
                ? callback(undefined, [m])
                : fail(`the driver refused it: ${err || "no reason given"}`);
            this.#pending.set(id, { addr, metric: m, timer, callback: answer });
        }
    }

    /* Send one write in both forms. A driver subscribes to the form it
     * understands, so the agent doesn't need to know which: cmd/ is
     * the value as raw bytes, as drivers have always had it, and
     * write/ is JSON with the Sparkplug type. A form that can't carry
     * this value is left out, unless it is the one the driver reads:
     * a write that expects an answer (it has an id) goes to a driver
     * that answers typed writes, and any other write may go to a
     * driver that only reads cmd/. If that form can't carry the value,
     * nothing is sent and the write is an error, so the device doesn't
     * report a value no driver received. The id goes in the typed form
     * for the driver to answer with. */
    #write_metric (addr: string, m: sparkplugMetric, id?: string): Error | undefined {
        const typed = id === undefined
            ? writeValToJSON
            : (m: sparkplugMetric) => Buffer.from(JSON.stringify({
                ...JSON.parse(writeValToJSON(m).toString()), id,
            }));
        const forms: Array<[string, (m: sparkplugMetric) => Buffer]> = [
            ["cmd", writeValToBuffer],
            ["write", typed],
        ];
        const needed = id === undefined ? "cmd" : "write";
        const payloads: Array<[string, Buffer]> = [];
        const errs: string[] = [];

        for (const [msg, encode] of forms) {
            try {
                payloads.push([msg, encode(m)]);
            }
            catch (e) {
                errs.push(`${msg}: ${(e as Error).message}`);
            }
        }

        const why = `Can't write ${m.name} to ${addr}: ${errs.join(", ")}`;
        if (errs.some(e => e.startsWith(`${needed}:`))) {
            return id === undefined
                ? new Error(`${why}. This driver doesn't answer writes, `
                    + `so it reads cmd/, which can't carry this value.`)
                : new Error(`it can't be sent as a typed write: ${errs.join(", ")}`);
        }

        for (const [msg, payload] of payloads)
            this.broker.publish({ id: this.id, msg, data: addr, payload });
        if (errs.length)
            log(`DRIVER [${this.id}]: ${why}`);
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

    /* A new data topic name: a decimal integer, counting up from a
     * random start below 100000. Names are never reused within one
     * connection (addresses stay in `addrs`), so the count always
     * finds a free one, and a new connection after a reload starts
     * somewhere else, so data a driver sent under the old names is
     * unlikely to match a new one. */
    #newTopic () {
        while (this.addrs.has(this.#nextTopic.toString()))
            this.#nextTopic++;
        return (this.#nextTopic++).toString();
    }

    #message (message) {
        const { id, msg, data, payload } = message;
        if (id != this.id) return;

        //log(util.format("DRIVER message: %s %s", id, msg));
        /* Anything else the driver says comes after the data it sent
         * before, so hand that data on first. A status change can close
         * the devices, and a write result reports a value. Scout
         * results have nothing to do with the data, so they don't
         * split a group of values during a scan. */
        if (msg != "data" && msg != "found") this.#flush_data();

        switch (msg) {
        case "status":  return this.#msg_status(payload.toString());
        case "data":    return this.#msg_data(data, payload);
        case "err":     return this.#msg_err(data, payload.toString());
        case "result":  return this.#msg_result(data, payload.toString());
        /* The ScoutManager listens for these. See lib/scout.ts. */
        case "found":   return void this.emit("found", data, payload);

        /* Our messages are looped */
        case "active":
        case "conf":
        case "addr":
        case "cmd":
        case "write":
        case "poll":
        case "scout":
            return;
        }
        log(`Unexpected ${msg} message from ${id}`);
    }

    #msg_status (status: string) {
        const ost = this.status;
        this.status = status;
        log(`DRIVER [${this.id}]: status ${ost} -> ${status}`);
        if (status == "UP" && ost != "UP")
            this.up_since = Date.now();
        else if (status != "UP")
            this.up_since = null;
        /* Before the conf below goes out, so that the ScoutManager
         * can cancel a running scan ahead of the new config. */
        this.emit("status", status, ost);

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
            /* The optional parts of the protocol this agent serves. A
             * driver subscribes to scout only after it sees this on
             * its current session. See "Scouting" in
             * docs/edge-split.md. */
            features: DRIVER_FEATURES,
        };
        this.broker.publish({
            id:         this.id,
            msg:        "addr",
            payload:    Buffer.from(JSON.stringify(addrs)),
        });
    }

    /* Each data message carries one address. Messages that arrive
     * together are gathered and handed to the devices as one data
     * event, so each device publishes one DDATA for them, as the
     * built-in connections do for a notification or a poll. The
     * group goes at the end of this turn of the event loop, or after
     * DRIVER_DATA_WAIT_MS if that is set. A second message for an
     * address already in the group sends the group first, so every
     * value is still published, in the order it came. */
    #msg_data (data: string, payload: Buffer) {
        const addr = this.addrs.get(data);
        //log(`Driver [${this.id}]: data ${data} ${addr}`);
        /* The empty string is an address: the UDP connection delivers
         * every datagram to it. */
        if (addr === undefined) return;

        if (addr in this.#data) this.#flush_data();
        this.#data[addr] = payload;
        this.#received[addr] = { ms: Date.now(), ns: now_ns() };
        this.#dataCount++;

        if (this.#dataTimer) return;
        const flush = () => {
            this.#dataTimer = null;
            this.#flush_data();
        };
        this.#dataTimer = this.#dataWait > 0
            ? setTimeout(flush, this.#dataWait)
            : setImmediate(flush);
    }

    /* Hand the gathered data to the devices now. */
    #flush_data () {
        if (this.#dataCount == 0) return;
        const obj = this.#data;
        const group: DataGroup = { received: this.#received };
        this.#drop_data();
        this.emit("data", obj, true, group);
    }

    #drop_data () {
        if (this.#dataTimer) {
            if (this.#dataWait > 0)
                clearTimeout(this.#dataTimer as NodeJS.Timeout);
            else
                clearImmediate(this.#dataTimer as NodeJS.Immediate);
            this.#dataTimer = null;
        }
        this.#data = Object.create(null);
        this.#received = Object.create(null);
        this.#dataCount = 0;
    }

    /* A driver's answer to a write: empty if it was written, otherwise
     * an error code, optionally followed by a newline and a message. */
    #msg_result (id: string, result: string) {
        const w = this.#pending.get(id);
        if (!w) {
            console.log(`DRIVER [${this.id}]: answer to unknown write ${id} ignored`
                + (result ? `: ${result.replace(/\n/, " ")}` : ""));
            return;
        }
        this.#pending.delete(id);
        clearTimeout(w.timer);
        w.callback(result == "" ? undefined : result.replace(/\n/, " ").trim());
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
