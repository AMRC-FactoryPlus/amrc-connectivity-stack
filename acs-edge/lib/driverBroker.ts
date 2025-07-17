/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import {EventEmitter} from "events";
import fs from "fs/promises";
import net from "net";
import util from "util";

import Aedes from "aedes";

const prefix = "fpEdge1";
const topicrx = new RegExp(`^${prefix}/([\\w-]+)/(\\w+)(?:/(\\w+))?$`);

function log (f, ...a) {
    const msg = util.format(f, ...a);
    console.log("driver: %s", msg);
}

interface ACL {
    publish:    RegExp,
    subscribe:  RegExp,
}

export class DriverBroker extends EventEmitter {
    broker:     Aedes
    passwords:  string
    debugUser:  string | undefined
    acl:        Map<string, ACL>
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
        this.debugUser = env.EDGE_DEBUG_USER;

        this.broker = new Aedes();
        this.acl = new Map();

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
        return new Promise<void>(resolve => {
            srv.once("listening", () => {
                log("Listening: %o", srv.address());
                resolve();
            });
            srv.listen(this.port, this.hostname);
        });
    }

    stop () {
        return new Promise<void>(resolve => 
            this.broker.close(resolve));
    }

    async auth (client, username, password, callback) {
        const { id } = client;
        log("AUTH: %s, %s, %s", id, username, password);

        const fail = (f, ...a) => { log(f, ...a); callback(null, false); };

        if (!password)
            return fail("No password for %s", username);
        const expect = await fs.readFile(`${this.passwords}/${username}`)
            .catch(e => null);
        if (!expect)
            return fail("Unknown user %s", username);
        if (expect.compare(password) != 0)
            return fail("Bad password for %s", username);

        if (username == this.debugUser) {
            this.acl.set(id, {
                publish: /./,
                subscribe: /./,
            });
            return callback(null, true);
        }
        
        if (id != username)
            return fail("Invalid client-id %s for %s", id, username);

        this.acl.set(id, {
            publish: new RegExp(
                `^${prefix}/${id}/(?:status|data/\\w+|err/\\w+)$`),
            subscribe: new RegExp(
                `^${prefix}/${id}/(?:active|conf|addr|cmd/#|poll)$`),
        });

        callback(null, true);
    }

    authPub (client, packet, callback) {
        const { id } = client;
        const { topic } = packet;

        //log("PUBLISH: %s %s", id, topic);
        if (packet.retain)
            return callback(new Error("Retained PUBLISH forbidden"));
        if (!this.acl.get(id)!.publish.test(topic))
            return callback(new Error("Unauthorised PUBLISH"));
        callback(null);
    }

    authSub (client, subscription, callback) {
        const { id } = client;
        const { topic } = subscription;

        log("SUBSCRIBE: %s %s", id, topic);
        if (!this.acl.get(id)!.subscribe.test(topic))
            return callback(new Error("Unauthorised SUBSCRIBE"));
        callback(null, subscription);
    }

    message (topic, payload) {
        //log("PACKET: %s %o", topic, payload);

        const match = topic.match(topicrx);
        if (!match) {
            log("Received message on unknown topic %s", topic);
            return;
        }

        const [, id, msg, data] = match;
        this.emit("message", { id, msg, data, payload });
    }

    publish (packet: { id, msg, data?, payload }): Promise<void> {
        const { id, msg, data, payload } = packet;

        const topic = `${prefix}/${id}/${msg}` 
            + (data ? `/${data}` : "");
        //log("Publishing %s: %O", topic, packet);
        return new Promise((resolve, reject) =>
            this.broker.publish({
                cmd:    "publish",
                qos:    0,
                dup:    false,
                retain: false,
                topic, payload,
            }, err => err ? reject(err) : resolve()));
    }
}
