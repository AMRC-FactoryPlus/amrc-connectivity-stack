/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* A split driver's id is the connection's driverId when the config
 * gives one, and its name otherwise. A name with a dot can't be an id,
 * because the driver broker only routes [\w-]+, so the config gives
 * such a connection a driverId. A driver connecting under that id
 * must get its conf through the real broker. */

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import * as mqtt from "mqtt";

import { DriverBroker } from "../../lib/driverBroker";
import { Translator } from "../../lib/translator";

function freePort (): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once("error", reject);
        srv.listen(0, "localhost", () => {
            const { port } = srv.address() as net.AddressInfo;
            srv.close(() => resolve(port));
        });
    });
}

async function until (cond: () => boolean, what: string, ms = 5_000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end)
            throw new Error(`Timed out waiting for ${what}`);
        await new Promise(r => setTimeout(r, 10));
    }
}

const NAME = "api.example.org";
const ID = "api-example-org-1a2b3c4d";

describe("split driver id", () => {
    let passwords: string;
    let broker: DriverBroker;
    let translator: Translator;
    let port: number;
    const clients: mqtt.MqttClient[] = [];

    beforeAll(() => {
        passwords = fs.mkdtempSync(path.join(os.tmpdir(), "driver-pw-"));
        for (const user of [NAME, ID, "plc-1"])
            fs.writeFileSync(path.join(passwords, user), "secret");
    });

    afterAll(() => {
        fs.rmSync(passwords, { recursive: true, force: true });
    });

    beforeEach(async () => {
        port = await freePort();
        broker = new DriverBroker({
            EDGE_MQTT: `mqtt://localhost:${port}`,
            EDGE_PASSWORDS: passwords,
        });
        await broker.start();
        translator = new Translator({} as any, 1000, broker);
        jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(async () => {
        await Promise.all(clients.splice(0).map(c =>
            new Promise(r => c.end(true, {}, r))));
        await broker.stop();
        jest.restoreAllMocks();
    });

    /* Connect as a driver, say READY and collect the confs. */
    function driver (id: string) {
        const confs: any[] = [];
        const c = mqtt.connect(`mqtt://localhost:${port}`, {
            clientId: id, username: id, password: "secret",
            reconnectPeriod: 0,
        });
        clients.push(c);
        c.on("message", (_t, p) => confs.push(JSON.parse(p.toString())));
        c.on("connect", () =>
            c.subscribe(`fpEdge1/${id}/conf`, () =>
                c.publish(`fpEdge1/${id}/status`, "READY")));
        return confs;
    }

    function connect (conn: any) {
        return translator.setupConnection({
            connType: "Driver", DriverDetails: { marker: conn.name },
            devices: [], ...conn,
        });
    }

    it("uses the driverId of a connection whose name has a dot", async () => {
        await connect({ name: NAME, driverId: ID });
        expect((translator.connections.Driver as any).id).toBe(ID);

        const confs = driver(ID);
        await until(() => confs.length == 1, "conf");
        expect(confs).toEqual([{ marker: NAME }]);
    });

    it("uses the name of a connection with no driverId", async () => {
        await connect({ name: "plc-1" });
        expect((translator.connections.Driver as any).id).toBe("plc-1");

        const confs = driver("plc-1");
        await until(() => confs.length == 1, "conf");
        expect(confs).toEqual([{ marker: "plc-1" }]);
    });

    /* Why the driverId is needed: the broker drops the status of a
     * driver whose id has a dot, so it never gets its conf. */
    it("never sends conf to a driver whose id has a dot", async () => {
        await connect({ name: NAME });

        const confs = driver(NAME);
        await new Promise(r => setTimeout(r, 300));
        expect(confs).toEqual([]);
    });
});
