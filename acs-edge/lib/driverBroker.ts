/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2024 AMRC
 */

import { EventEmitter } from "events";
import fs from "fs/promises";
import net from "net";
import util from "util";

import Aedes from "aedes";

const prefix = "fpEdge1";
const topicrx = new RegExp(`^${prefix}/(\\w+)/(\\w+)(?:/(\\w+))?$`);

function log (f, ...a) {
    const msg = util.format(f, ...a);
    console.log("DRIVER: %s", msg);
}

export class DriverBroker extends EventEmitter {
    broker:     Aedes
    passwords:  string
    publish:    Map<string, RegExp>
    subscribe:  Map<string, RegExp>
    hostname:   string
    port:       number

    constructor (env) {
        super();

        const url = new URL(env.EDGE_MQTT);

        if (url.protocol != "mqtt:")
            throw new Error(`Unknown URL scheme ${url.protocol}`);

        this.hostname = url.hostname;
        this.port = url.port
            ? Number.parseInt(url.port, 10)
            : 1883;

        this.passwords = env.EDGE_PASSWORDS;

        this.broker = new Aedes();
        this.publish = new Map();
        this.subscribe = new Map();

        const br = this.broker;
        br.authenticate = this.auth.bind(this);
        br.authorizePublish = this.authPub.bind(this);
        br.authorizeSubscribe = this.authSub.bind(this);

        br.subscribe(`${prefix}/#`, (packet, callback) => {
            callback();
            this.message(packet.topic, packet.payload);
        }, () => {});
    }

    start () {
        const srv = net.createServer(this.broker.handle);
        srv.on("listening", () => 
            log("Listening: %o", srv.address()));
        srv.listen(this.port, this.hostname);
    }

    stop () {
        return new Promise<void>(resolve => 
            this.broker.close(resolve));
    }

    async auth (client, username, password, callback) {
        const { id } = client;
        log("AUTH: %s, %s, %s", id, username, password);

        const fail = (f, ...a) => { log(f, ...a); callback(null, false); };

        if (id != username)
            return fail("Invalid client-id %s for %s", id, username);
        if (!password)
            return fail("No password for %s", username);
        const expect = await fs.readFile(`${this.passwords}/${username}`)
            .catch(e => null);
        if (!expect)
            return fail("Unexpected driver %s", username);
        if (expect.compare(password) != 0)
            return fail("Bad password for %s", username);

        this.publish.set(id, new RegExp(
            `^${prefix}/${id}/(?:status|data/\\w+|err/\\w+)$`));
        this.subscribe.set(id, new RegExp(
            `^${prefix}/${id}/(?:conf|addr|cmd/\\w+|poll)$`));

        callback(null, true);
    }

    authPub (client, packet, callback) {
        const { id } = client;
        const { topic } = packet;

        log("PUBLISH: %s %s", id, topic);
        if (packet.retain)
            return callback(new Error("Retained PUBLISH forbidden"));
        if (!this.publish.get(id)!.test(topic))
            return callback(new Error("Unauthorised PUBLISH"));
        callback(null);
    }

    authSub (client, subscription, callback) {
        const { id } = client;
        const { topic } = subscription;

        log("SUBSCRIBE: %s %s", id, topic);
        if (!this.subscribe.get(id)!.test(topic))
            return callback(new Error("Unauthorised SUBSCRIBE"));
        callback(null, subscription);
    }

    message (topic, payload) {
        log("PACKET: %s %o", topic, payload);

        const match = topic.match(topicrx);
        if (!match) {
            log("Received message on unknown topic %s", topic);
            return;
        }

        const [, id, msg, data] = match;
        this.emit("message", { id, msg, data, payload });
    }
}
