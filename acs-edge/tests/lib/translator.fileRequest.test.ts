/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Driver req/file: the agent fetches a file from the Files service on
 * a driver's behalf and replies on rsp/file. */

import { Readable } from "stream";

import { Translator } from "../../lib/translator";
import * as UUIDs from "../../lib/uuids";

const UUID = "0e3f4b1c-9a2d-4c5e-8f6a-7b8c9d0e1f2a";
const DATA = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x0a]);

/* A Files service answering every fetch with `status` and `chunks`. */
function setup (status: number, chunks: Buffer[] = [], length?: number) {
    const fetches: any[] = [];
    let read = false;
    const fplus: any = {
        Fetch: {
            fetch: async (opts: any) => {
                fetches.push(opts);
                return {
                    status,
                    headers: { get: (h: string) =>
                        h == "content-length" && length != null ? String(length) : null },
                    body: Readable.from((function* () {
                        read = true;
                        yield* chunks;
                    })()),
                };
            },
        },
    };
    const replies: any[] = [];
    const broker: any = {
        publish: async (p: any) => { replies.push({ ...p, body: JSON.parse(p.payload) }); },
    };
    const translator = new Translator(fplus, 1000, broker);
    const request = (payload = UUID) => translator.driverRequest({
        id: "ftp", msg: "req", data: "file", payload: Buffer.from(payload),
    });
    return { translator, fetches, replies, request, wasRead: () => read };
}

test("a file is fetched and sent back base64-encoded", async () => {
    const { fetches, replies, request } = setup(200, [DATA.subarray(0, 2), DATA.subarray(2)]);
    await request();

    expect(fetches).toEqual([{
        service:    UUIDs.Service.Files,
        url:        `/v1/file/${UUID}`,
        headers:    { Accept: "application/octet-stream" },
        cache:      "no-store",
    }]);
    expect(replies).toHaveLength(1);
    expect(replies[0].id).toBe("ftp");
    expect(replies[0].msg).toBe("rsp");
    expect(replies[0].data).toBe("file");
    expect(replies[0].body).toEqual({
        uuid: UUID, size: DATA.length, content: DATA.toString("base64"),
    });
});

test.each([
    [0, /Can't reach the Files service/],
    [403, /may not download that file/],
    [404, /File not found/],
    [500, /returned 500/],
])("status %d is reported as an error", async (status, rx) => {
    const { replies, request } = setup(status);
    await request();
    expect(replies[0].body.uuid).toBe(UUID);
    expect(replies[0].body.error).toMatch(rx);
    expect(replies[0].body.content).toBeUndefined();
});

test("a file over the limit is refused from its length", async () => {
    const { translator, replies, request, wasRead } = setup(200, [DATA], 11);
    translator.fileLimit = 10;
    await request();
    expect(replies[0].body.error).toMatch(/11 bytes, over the 10 byte limit/);
    expect(wasRead()).toBe(false);
});

test("a file over the limit is refused as it arrives", async () => {
    const { translator, replies, request } = setup(200, [DATA, DATA, DATA]);
    translator.fileLimit = 12;
    await request();
    expect(replies[0].body.error).toMatch(/over the 12 byte limit/);
});

test("the limit comes from DRIVER_FILE_LIMIT, with a 10 MiB default", () => {
    expect(setup(200).translator.fileLimit).toBe(10 * 1024 * 1024);
    process.env.DRIVER_FILE_LIMIT = "2048";
    try {
        expect(setup(200).translator.fileLimit).toBe(2048);
    }
    finally {
        delete process.env.DRIVER_FILE_LIMIT;
    }
});

test("a request that isn't a UUID isn't fetched", async () => {
    const { fetches, replies, request } = setup(200, [DATA]);
    await request("../../etc/passwd");
    expect(fetches).toHaveLength(0);
    expect(replies[0].body.error).toBe("Not a file UUID");
});

test("unknown requests still get an error without a uuid", async () => {
    const { translator, replies } = setup(200);
    await translator.driverRequest({
        id: "ftp", msg: "req", data: "nonsense", payload: Buffer.from(UUID),
    });
    expect(replies[0].body).toEqual({ error: "Unknown request: nonsense" });
});
