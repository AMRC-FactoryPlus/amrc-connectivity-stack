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
    server?:    net.Server
    sockets:    Set<net.Socket> = new Set()

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

        /* Never call back from inside a callback. The callback
         * releases this message's slot in Aedes' mqemitter, and when
         * messages are queued it dispatches the next one to us before
         * it returns. Calling back straight away therefore drains the
         * whole queue recursively, one set of stack frames per
         * message, and a few thousand queued driver messages overflow
         * the stack. Instead, a call made during a callback only
         * handles its message and leaves its callback for the
         * outermost call to make, in a loop. The stack stays flat,
         * messages are handled in queue order, and nothing waits for
         * a later tick. */
        const callbacks: Array<() => void> = [];
        let releasing = false;
        br.subscribe(`${prefix}/#`, (packet, callback) => {
            callbacks.push(callback);
            this.message(packet.topic, packet.payload);
            if (releasing) return;
            releasing = true;
            try {
                let cb;
                while ((cb = callbacks.shift()))
                    cb();
            }
            finally {
                releasing = false;
            }
        }, () => {});
    }

    start () {
        const srv = this.server = net.createServer(this.broker.handle);
        srv.on("connection", sock => {
            this.sockets.add(sock);
            sock.once("close", () => this.sockets.delete(sock));
        });
        return new Promise<void>(resolve => {
            srv.once("listening", () => {
                log("Listening: %o", srv.address());
                resolve();
            });
            srv.listen(this.port, this.hostname);
        });
    }

    /* Release the port as well as the broker. The agent restarts
     * in-process to reload its config and starts a new broker on the
     * same port, so the listening socket and every driver connection
     * must be closed before this resolves. */
    async stop () {
        await new Promise<void>(resolve => this.broker.close(() => resolve()));

        const srv = this.server;
        if (!srv) return;
        this.server = undefined;

        for (const sock of this.sockets)
            sock.destroy();
        this.sockets.clear();

        await new Promise<void>(resolve => srv.close(() => resolve()));
        log("Stopped listening");
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
                `^${prefix}/${id}/(?:status|data/\\w+|err/\\w+|req/\\w+)$`),
            subscribe: new RegExp(
                `^${prefix}/${id}/(?:active|conf|addr|cmd/#|poll|rsp/\\w+)$`),
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
