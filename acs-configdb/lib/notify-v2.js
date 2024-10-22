/*
 * ACS ConfigDB
 * Change-notify WS interface
 * Copyright 2024 University of Sheffield
 */

import rx from "rxjs";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

export class Notify {
    constructor (opts) {
        this.log = opts.log;
        this.model = opts.model;
    }

    setup (server, path) {
        this.wss = new WebSocketServer({ server, path });
        this.wss.on("connection", this.new_client.bind(this));
    }

    new_client (ws) {
        const uuid = uuidv4();
        this.log("New client: %s", uuid);

        const sub = this.model.updates.subscribe(u => {
            const data = JSON.stringify(u, null, 2);
            this.log("Notify %s: %s", uuid, data);
            ws.send(data);
        });

        ws.on("close", () => {
            this.log("Client closed: %s", uuid);
            sub.unsubscribe();
        });
    }
}
