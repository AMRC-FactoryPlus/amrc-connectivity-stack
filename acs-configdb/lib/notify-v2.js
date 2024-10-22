/*
 * ACS ConfigDB
 * Change-notify WS interface
 * Copyright 2024 University of Sheffield
 */

//import rx from "rxjs";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

const Token_rx = /^Bearer ([A-Za-z0-9+/]+)$/;

class Session {
    constructor (opts) {
        this.ws = opts.ws;

        this.fpauth = opts.notify.api.auth;
        this.log = (m, ...a) => 
            opts.notify.log(`[%s] ${m}`, this.uuid, ...a);
        this.updates = opts.notify.model.updates;

        this.uuid = uuidv4();
    }

    async start () {
        this.log("New client");
        this.ws.addEventListener("close", () => this.log("Client closed"));

        this.principal = await this.auth();
        if (!this.principal) return;
        this.send_updates();
    }

    async auth () {
        const { ws } = this;

        const fail = (st, msg) => {
            this.log(msg);
            ws.send(st);
            ws.close();
            return null;
        };

        const msg = await new Promise((resolve, reject) => {
            ws.addEventListener("message", resolve, { once: true });
            ws.addEventListener("error", reject, { once: true });
        });

        if (typeof msg.data != "string")
            return fail("400", "Binary auth message");
        const creds = Token_rx.exec(msg.data);
        if (!creds)
            return fail("400", "Bad auth message");

        const princ = await this.fpauth.auth_bearer({ creds: creds[1] })
            .catch(e => { this.log(e); return null; });
        if (!princ)
            return fail("401", "WS auth failed");

        /* XXX authorise? */
        ws.send("200");
        this.log("WebSocket authenticated for %s", princ);
        return princ;
    }

    send_updates () {
        const { ws } = this;

        const sub = this.updates.subscribe(u => {
            const data = JSON.stringify(u, null, 2);
            this.log("Notify %s", data);
            ws.send(data);
        });
        ws.on("close", () => sub.unsubscribe());
    }
}

export class Notify {
    constructor (opts) {
        this.log = opts.log;
        this.model = opts.model;
        this.api = opts.api;
    }

    run () {
        this.wss = new WebSocketServer({ 
            server: this.api.http, 
            path:   "/notify/v2",
        });
        this.wss.on("connection", this.new_client.bind(this));
    }

    new_client (ws) {
        new Session({ notify: this, ws }).start();
    }
}
