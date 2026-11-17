/*
 * ACS Edge Agent
 * Data from a split driver reaches the device for every address,
 * including the empty one the UDP connection uses
 * Copyright 2026 University of Sheffield
 */

import { DriverConnection } from "../../../lib/devices/driver";
import { DriverBroker } from "../../../lib/driverBroker";

const ID = "udp";

class FakeBroker {
    listener?: (m: any) => void;
    on (_ev: string, l: (m: any) => void) { this.listener = l; }
    off () {}
    publish () {}
    send (msg: string, data: string | undefined, payload: Buffer) {
        this.listener!({ id: ID, msg, data, payload });
    }
}

describe("DriverConnection data", () => {
    let broker: FakeBroker;
    let conn: DriverConnection;
    let got: any[];

    beforeEach(() => {
        broker = new FakeBroker();
        conn = new DriverConnection("Driver", {}, ID, broker as unknown as DriverBroker);
        conn.open();
        got = [];
        conn.on("data", obj => got.push(obj));
        conn.addrs.set("17", "");
        conn.topics.set("", "17");
        conn.addrs.set("18", "a/b");
        conn.topics.set("a/b", "18");
    });

    it("delivers data for the empty address", () => {
        broker.send("data", "17", Buffer.from("datagram"));
        expect(got).toEqual([{ "": Buffer.from("datagram") }]);
    });

    it("delivers data for other addresses as before", () => {
        broker.send("data", "18", Buffer.from("x"));
        expect(got).toEqual([{ "a/b": Buffer.from("x") }]);
    });

    it("drops data for a topic not in the map", () => {
        broker.send("data", "99", Buffer.from("x"));
        expect(got).toEqual([]);
    });
});
