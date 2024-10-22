/*
 * ACS ConfigDB
 * Change-notify WS interface
 * Copyright 2024 University of Sheffield
 */

//import rx from "rxjs";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

const Token_rx = /^Bearer ([A-Za-z0-9+/]+)$/;

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

    async new_client (ws) {
        const uuid = uuidv4();

        this.log("New client: %s", uuid);
        ws.on("close", () => this.log("Client closed: %s", uuid));

        const fail = (st, msg) => {
            this.log("%s for %s", msg, uuid);
            ws.send(st);
            ws.close();
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

        const token = creds[1];
        this.log("Verifying Bearer token [%s]", token);
        const princ = await this.api.auth.auth_bearer({ creds: token })
            .catch(e => { this.log(e); return null; });
        if (!princ)
            return fail("401", "Unknown token");

        /* XXX authorise? */
        ws.send("200");

        const sub = this.model.updates.subscribe(u => {
            const data = JSON.stringify(u, null, 2);
            this.log("Notify %s: %s", uuid, data);
            ws.send(data);
        });
        ws.on("close", () => sub.unsubscribe());
    }
}
