/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import {EventEmitter} from "events";
import fs from "fs/promises";
import net from "net";
import util from "util";

import Aedes from "aedes";

const prefix = "fpEdge1";
/* The data part is a data topic for data, err, req and rsp and a write
 * id for result, but a whole device address for cmd and write, which
 * may contain any character MQTT allows in a topic, including "/". The
 * ACLs keep drivers to \w+. */
const topicrx = new RegExp(`^${prefix}/([\\w-]+)/(\\w+)(?:/(.+))?$`);

function log (f, ...a) {
    const msg = util.format(f, ...a);
    console.log("driver: %s", msg);
}

export interface ACL {
    publish:    RegExp,
    subscribe:  RegExp,
}

/* The ACL a driver gets, by its connection name. */
export function driver_acl (id: string): ACL {
    return {
        publish: new RegExp(
            `^${prefix}/${id}/(?:status|data/\\w+|err/\\w+|req/\\w+|result/\\w+|found/\\w+)$`),
        subscribe: new RegExp(
            `^${prefix}/${id}/(?:active|conf|addr|cmd/#|write/#|poll|rsp/\\w+|scout)$`),
    };
}

export interface DriverBrokerOpts {
    /* Tests only: the ACL to give each driver in place of
     * driver_acl, such as an older agent's. */
    acl?:   (id: string) => ACL,
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
    /* Drivers that subscribed to their own write/#, by client id, with
     * the client that did it. Such a driver answers each write on
     * result/<id>, so the agent waits for the answer before it
     * reports the value. See "Write results" in docs/edge-split.md. */
    #typed:     Map<string, any> = new Map()
    /* Drivers that subscribed to their own scout topic, by client id,
     * kept in the same way. A driver only does that once it has seen
     * features.scout in an addr on its current session. See
     * "Scouting" in docs/edge-split.md. */
    #scouts:    Map<string, any> = new Map()
    #driver_acl: (id: string) => ACL

    constructor (env, opts: DriverBrokerOpts = {}) {
        super();

        this.#driver_acl = opts.acl ?? driver_acl;

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

        br.on("subscribe", (subs, client) => {
            if (!client) return;
            if (subs.some(s => s.topic == this.#write_topic(client)))
                this.#typed.set(client.id, client);
            if (subs.some(s => s.topic == this.#scout_topic(client))) {
                this.#scouts.set(client.id, client);
                this.emit("scout", client.id, true);
            }
        });
        br.on("unsubscribe", (topics, client) => {
            if (!client) return;
            if (topics.includes(this.#write_topic(client)))
                this.#forget(this.#typed, client);
            if (topics.includes(this.#scout_topic(client)))
                this.#forget_scout(client);
        });
        br.on("clientDisconnect", client => {
            this.#forget(this.#typed, client);
            this.#forget_scout(client);
        });

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

    /* The write/# topic of the connection a client may drive. Only a
     * client whose id is the connection name counts, so the debug user
     * watching a driver's writes doesn't make the agent wait. */
    #write_topic (client): string {
        return `${prefix}/${client.id}/write/#`;
    }

    #scout_topic (client): string {
        return `${prefix}/${client.id}/scout`;
    }

    /* A driver that reconnects under the same id replaces the old
     * client, which may disconnect after the new one subscribed. */
    #forget (map: Map<string, any>, client): boolean {
        if (client && map.get(client.id) === client) {
            map.delete(client.id);
            return true;
        }
        return false;
    }

    #forget_scout (client) {
        if (this.#forget(this.#scouts, client))
            this.emit("scout", client.id, false);
    }

    /* Whether the driver for this connection answers writes. */
    confirms_writes (id: string): boolean {
        return this.#typed.has(id);
    }

    /* Whether the driver for this connection has subscribed to its
     * scout topic on its current session. */
    scouts (id: string): boolean {
        return this.#scouts.has(id);
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
        /* Never log the password itself. */
        log("AUTH: %s, %s", id, username);

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

        this.acl.set(id, this.#driver_acl(id));

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
