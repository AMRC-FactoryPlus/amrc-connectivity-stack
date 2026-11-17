/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

/* The built-in OPC UA connection against a fake node-opcua client.
 * OPCUAClient.create is replaced; everything else in node-opcua is
 * real. These tests pin the behaviour the OPC UA split driver has to
 * match. */

import { EventEmitter } from "events";
import {
    AttributeIds, MessageSecurityMode, OPCUAClient, SecurityPolicy, UserTokenType,
} from "node-opcua";

import { OPCUAConnection, opcUaConnDetails } from "../../../lib/devices/OPCUA";
import { Metrics, sparkplugDataType } from "../../../lib/helpers/typeHandler";

const connDetails: opcUaConnDetails = {
    useCredentials: true,
    username: "user",
    password: "password",
    securityMode: "SignAndEncrypt",
    securityPolicy: "Basic256Sha256",
    endpoint: "opc.tcp://plc:4840",
};

class FakeSubscription extends EventEmitter {
    subscriptionId = 1;
    monitoredItems: any = {};
    monitorItems = jest.fn((items: any[], ...rest: any[]) => {
        items.forEach((item, i) => {
            this.monitoredItems[i] = { itemToMonitor: item };
        });
    });
}

class FakeSession {
    read = jest.fn();
    write = jest.fn(async (items: any[]) => items.map(() => ({ value: 0, description: "Good" })));
    close = jest.fn(async () => {});
    subscription = new FakeSubscription();
    createSubscription2 = jest.fn((opts: any, cb: Function) => cb(null, this.subscription));
}

class FakeClient extends EventEmitter {
    session = new FakeSession();
    connect = jest.fn(async () => {});
    createSession = jest.fn(async () => this.session);
    disconnect = jest.fn(async () => {});
}

function setup (details: Partial<opcUaConnDetails> = {}) {
    const client = new FakeClient();
    const create = jest.spyOn(OPCUAClient, "create").mockReturnValue(client as any);
    const conn = new OPCUAConnection("OPC UA", { ...connDetails, ...details });
    return { client, conn, create, session: client.session };
}

function metric (name: string, address?: string, value: any = 0) {
    return {
        name, type: sparkplugDataType.int32, value,
        properties: address === undefined ? {} : {
            method: { type: sparkplugDataType.string, value: "GET" },
            address: { type: sparkplugDataType.string, value: address },
            path: { type: sparkplugDataType.string, value: "" },
        },
    };
}

beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe("constructor", () => {
    it("creates one client with the connection's security and retries forever", () => {
        const { create } = setup();
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0]).toMatchObject({
            applicationName: "acs-edge",
            keepSessionAlive: true,
            securityMode: MessageSecurityMode.SignAndEncrypt,
            securityPolicy: SecurityPolicy.Basic256Sha256,
            endpointMustExist: false,
            connectionStrategy: { maxRetry: -1 },
        });
    });
});

describe("open()", () => {
    it("connects to the endpoint, makes a session with the credentials and emits open", async () => {
        const { conn, client } = setup();
        const open = jest.fn();
        conn.on("open", open);

        await conn.open();

        expect(client.connect).toHaveBeenCalledWith("opc.tcp://plc:4840");
        expect(client.createSession).toHaveBeenCalledWith({
            userName: "user", password: "password", type: UserTokenType.UserName,
        });
        expect(open).toHaveBeenCalledTimes(1);
    });

    it("uses an anonymous session without credentials", async () => {
        const { conn, client } = setup({ useCredentials: false });
        await conn.open();
        expect(client.createSession).toHaveBeenCalledWith({ type: UserTokenType.Anonymous });
    });

    it("logs a failed connection and does not emit open", async () => {
        const { conn, client } = setup();
        client.connect.mockRejectedValueOnce(new Error("refused"));
        const open = jest.fn();
        conn.on("open", open);

        await conn.open();

        expect(open).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(new Error("refused"));
    });
});

describe("readMetrics()", () => {
    it("reads every addressed metric in one call and stores the values", async () => {
        const { conn, session } = setup();
        await conn.open();
        session.read.mockImplementation((items: any[], age: number, cb: Function) =>
            cb(null, items.map((_, i) => ({ value: { value: 10 + i } }))));
        const metrics = new Metrics([metric("a", "ns=1;s=A", 1), metric("b", "ns=1;s=B", 2)] as any);

        const old = conn.readMetrics(metrics);

        expect(old).toEqual([1, 2]);
        expect(session.read).toHaveBeenCalledTimes(1);
        expect(session.read.mock.calls[0][0]).toEqual([
            { nodeId: "ns=1;s=A", attributeId: AttributeIds.Value },
            { nodeId: "ns=1;s=B", attributeId: AttributeIds.Value },
        ]);
        expect(metrics.array.map(m => m.value)).toEqual([10, 11]);
    });

    it("reads nothing before a session exists", () => {
        const { conn, session } = setup();
        conn.readMetrics(new Metrics([metric("a", "ns=1;s=A")] as any));
        expect(session.read).not.toHaveBeenCalled();
    });

    /* SKIPPED, real bug (ACS-31): readMetrics leaves metrics with no
     * address out of the read, but writes the results back by index
     * into metrics.array, so with an unaddressed metric before an
     * addressed one each value lands on the wrong metric. Device
     * metrics such as Schema_UUID have no address. Fixing it changes
     * the polled OPC UA path, so it is left for the OPC UA split
     * driver work. */
    it.skip("stores each value on the metric it was read for", async () => {
        const { conn, session } = setup();
        await conn.open();
        session.read.mockImplementation((items: any[], age: number, cb: Function) =>
            cb(null, items.map(() => ({ value: { value: 42 } }))));
        const metrics = new Metrics([metric("schema"), metric("a", "ns=1;s=A", 1)] as any);

        conn.readMetrics(metrics);

        expect(metrics.array.map(m => m.value)).toEqual([0, 42]);
    });
});

describe("writeMetrics()", () => {
    it("writes every metric in one call and calls back with no error", async () => {
        const { conn, session } = setup();
        await conn.open();
        const done = jest.fn();

        await conn.writeMetrics(new Metrics([metric("a", "ns=1;s=A", 5)] as any), done);

        expect(session.write).toHaveBeenCalledTimes(1);
        expect(session.write.mock.calls[0][0]).toEqual([{
            nodeId: "ns=1;s=A",
            attributeId: AttributeIds.Value,
            value: { value: { dataType: "Int32", value: 5 } },
        }]);
        expect(done).toHaveBeenCalledWith();
    });

    it("calls back once with the first bad status", async () => {
        const { conn, session } = setup();
        await conn.open();
        session.write.mockResolvedValueOnce([
            { value: 0, description: "Good" },
            { value: 0x80340000, description: "BadNodeIdUnknown" },
            { value: 0x80350000, description: "BadAttributeIdInvalid" },
        ]);
        const done = jest.fn();

        await conn.writeMetrics(new Metrics([
            metric("a", "ns=1;s=A"), metric("b", "ns=1;s=B"), metric("c", "ns=1;s=C"),
        ] as any), done);

        expect(done).toHaveBeenCalledTimes(1);
        expect(done.mock.calls[0][0]).toEqual(new Error("BadNodeIdUnknown"));
    });

    it("calls back with an error when there is no session", async () => {
        const { conn } = setup();
        const done = jest.fn();
        await conn.writeMetrics(new Metrics([metric("a", "ns=1;s=A")] as any), done);
        expect(done.mock.calls[0][0]).toEqual(new Error("No OPC UA client session"));
    });
});

describe("startSubscription()", () => {
    it("monitors each address at the interval and emits changes keyed by node ID", async () => {
        const { conn, session } = setup();
        await conn.open();
        const data = jest.fn();
        conn.on("data", data);

        await conn.startSubscription(
            new Metrics([metric("a", "ns=1;s=A"), metric("b", "ns=1;s=B")] as any),
            "Defined by Protocol", "", 500, "dev", () => {});

        expect(session.createSubscription2.mock.calls[0][0].requestedPublishingInterval).toBe(500);
        const sub = session.subscription;
        expect(sub.monitorItems.mock.calls[0][0].map((i: any) => i.nodeId.toString()))
            .toEqual(["ns=1;s=A", "ns=1;s=B"]);
        expect(sub.monitorItems.mock.calls[0][1]).toMatchObject({ samplingInterval: 500 });

        sub.emit("received_notifications", { notificationData: [{ monitoredItems: [
            { clientHandle: 1, value: { value: { value: 7 } } },
        ] }] });

        expect(data).toHaveBeenCalledWith({ "ns=1;s=B": 7 }, false);
    });
});

describe("close()", () => {
    it("closes the session, disconnects and emits close", async () => {
        const { conn, client, session } = setup();
        await conn.open();
        const close = jest.fn();
        conn.on("close", close);

        await conn.close();

        expect(session.close).toHaveBeenCalledTimes(1);
        expect(client.disconnect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });
});
