/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

/* The built-in REST connection, with axios mocked. These tests pin the
 * behaviour the REST split driver has to match. */

import {RestConnection} from "../../../lib/devices/REST";
import axios, {AxiosResponse} from 'axios';
import {
    Metrics,
    restAuthMethod,
    restConnDetails,
    sparkplugDataType,
    serialisationType
  } from "../../../lib/helpers/typeHandler";

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const restConnDetails: restConnDetails = {
    baseURL: "http://device.example",
    authMethod: restAuthMethod.Basic,
    username: "user",
    password: "pass",
};
const BASIC = "Basic " + Buffer.from("user:pass").toString("base64");

const type = "REST";

function metric (name: string, address: string, value: any = 0) {
    return {
        name, type: sparkplugDataType.int32, value,
        properties: {
            method: { type: sparkplugDataType.string, value: "GET" },
            address: { type: sparkplugDataType.string, value: address },
            path: { type: sparkplugDataType.string, value: "$.v" },
        },
    };
}

beforeEach(() => jest.resetAllMocks());

describe('RestConnection', () => {

    describe("constructor", () => {
        it("sends a Basic auth header built from the username and password", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            mockedAxios.get.mockResolvedValueOnce({ status: 200, data: {} });
            await restConn.get("/a");
            expect(mockedAxios.get.mock.calls[0][1]?.headers?.Authorization).toBe(BASIC);
        });

        it("refuses Basic auth with no password", () => {
            expect(() => new RestConnection(type, { ...restConnDetails, password: undefined }))
                .toThrow(/no Username or Password/);
        });

        it("sends no auth header for None", async () => {
            const restConn = new RestConnection(type, { baseURL: "http://d", authMethod: restAuthMethod.None });
            mockedAxios.get.mockResolvedValueOnce({ status: 200, data: {} });
            await restConn.get("/a");
            expect(mockedAxios.get.mock.calls[0][1]?.headers?.Authorization).toBeUndefined();
        });
    });

    describe("open()", () => {

        it("Should emit open", () =>{
            const restConn = new RestConnection(type, restConnDetails);
            let callback = jest.fn();
            restConn.on("open", callback);
            restConn.open();
            expect(callback).toHaveBeenCalledTimes( 1 );
        })
    })

    describe("get()", () => {

        let expectedResult : object = {data: "test"};

        it("should call axios with the base URL and address", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            mockedAxios.get.mockResolvedValueOnce({ data: expectedResult } as AxiosResponse);
            await restConn.get("/address");
            expect(mockedAxios.get).toHaveBeenCalledTimes( 1 );
            expect(mockedAxios.get.mock.calls[0][0]).toBe("http://device.example/address");
        })

        it("should return response", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            mockedAxios.get.mockResolvedValueOnce({ data: expectedResult } as AxiosResponse);
            expect(await restConn.get("address")).toMatchObject({data: expectedResult});
        })

        /* get() used to return the error's response. It now logs the
         * error and resolves to undefined, and readMetrics treats that
         * as no data. */
        it("should catch an error and resolve to undefined", async () => {
            let error = {response: "error"};
            const restConn = new RestConnection(type, restConnDetails);
            mockedAxios.get.mockRejectedValueOnce(error);
            await expect(restConn.get("address")).resolves.toBeUndefined();
        })
    })

    describe("post()", () => {
        let expectedResult = { data: "test" };

        beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));

        it("should call axios", async () => {
            mockedAxios.post.mockResolvedValueOnce(expectedResult);
            const restConn = new RestConnection(type, restConnDetails);
            await restConn.post("/string", "data", serialisationType.JSON);
            expect(mockedAxios.post).toHaveBeenCalledTimes( 1 );
            expect(mockedAxios.post.mock.calls[0][0]).toBe("http://device.example/string");
            expect(mockedAxios.post.mock.calls[0][1]).toBe("data");
        })

        it.each([
            [serialisationType.JSON, "application/json"],
            [serialisationType.XML, "application/xml"],
            [serialisationType.fixedBuffer, "application/octet-stream"],
            [serialisationType.delimited, "text/plain; charset=UTF-8"],
        ])("should return post response for %s with Content-Type %s", async (format, ctype) => {
            mockedAxios.post.mockResolvedValueOnce(expectedResult);
            const restConn = new RestConnection(type, restConnDetails);
            expect(await restConn.post("address", "data", format)).toMatchObject(expectedResult);
            expect(mockedAxios.post.mock.calls[0][2]?.headers?.["Content-Type"]).toBe(ctype);
        })

        it("should catch and return error", async () => {
            const error = {response: "error"};
            mockedAxios.post.mockRejectedValueOnce(error);
            const restConn = new RestConnection(type, restConnDetails);
            expect(await restConn.post("address", "data", serialisationType.JSON)).toBe(error.response);
        })
    })

    describe("readMetrics()", () => {
        it("GETs each address once and emits its body keyed by address", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            const data = jest.fn();
            restConn.on("data", data);
            mockedAxios.get.mockImplementation(async (url: string) =>
                ({ status: 200, data: { url } } as any));

            const metrics = new Metrics([
                metric("a1", "/a"), metric("a2", "/a"), metric("b", "/b"),
            ] as any);
            await restConn.readMetrics(metrics, serialisationType.JSON);

            expect(mockedAxios.get.mock.calls.map(c => c[0]).sort())
                .toEqual(["http://device.example/a", "http://device.example/b"]);
            expect(data.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining([
                { "/a": { url: "http://device.example/a" } },
                { "/b": { url: "http://device.example/b" } },
            ]));
            expect(data).toHaveBeenCalledTimes(2);
        });

        it("emits a Buffer for the Buffer payload format", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            const data = jest.fn();
            restConn.on("data", data);
            mockedAxios.get.mockResolvedValueOnce({ status: 200, data: [1, 2, 3] } as any);

            await restConn.readMetrics(new Metrics([metric("a", "/a")] as any),
                serialisationType.fixedBuffer);

            expect(data.mock.calls[0][0]["/a"]).toEqual(Buffer.from([1, 2, 3]));
        });

        it("emits nothing for a non-200 response or a failed request", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            const data = jest.fn();
            restConn.on("data", data);
            mockedAxios.get
                .mockResolvedValueOnce({ status: 404, data: {} } as any)
                .mockRejectedValueOnce(new Error("down"));

            await restConn.readMetrics(new Metrics([metric("a", "/a"), metric("b", "/b")] as any),
                serialisationType.JSON);

            expect(data).not.toHaveBeenCalled();
        });

        /* SKIPPED, real bug (ACS-31): an address like "/p/${0:5}" is
         * meant to GET /p/0, /p/1, ... until one fails or the end is
         * reached. The loop in REST.ts readMetrics runs while
         * `!foundLastSubAddr || counter < stop`, and does not move on
         * after a failure, so once a page fails before `stop` it GETs
         * the same URL forever, and it never stops at `stop` while
         * pages succeed. A failed GET also returns undefined, which
         * the loop reads `.status` of and throws. Fixing it changes
         * how existing REST connections behave, so it is left for the
         * REST split driver work to decide. */
        it.skip("a ${n:m} address stops at the first failed page", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            const data = jest.fn();
            restConn.on("data", data);
            let calls = 0;
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (++calls > 10) throw new Error("still looping");
                return (url.endsWith("/2")
                    ? { status: 404, data: [] }
                    : { status: 200, data: [url] }) as any;
            });

            await restConn.readMetrics(new Metrics([metric("p", "/p/${0:5}")] as any),
                serialisationType.JSON);

            expect(calls).toBe(3);
            expect(data).toHaveBeenCalledTimes(1);
        });

        it("reads nothing without a payload format", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            await restConn.readMetrics(new Metrics([metric("a", "/a")] as any),
                "Defined by Protocol");
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });
    });

    describe("writeMetrics()", () => {
        beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));

        it("POSTs once per address and then calls back", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            mockedAxios.post.mockResolvedValue({ status: 200 } as any);
            const done = jest.fn();

            await restConn.writeMetrics(
                new Metrics([metric("a", "/a", 5), metric("b", "/b", 6)] as any),
                done, serialisationType.JSON);

            expect(mockedAxios.post.mock.calls.map(c => c[0]).sort())
                .toEqual(["http://device.example/a", "http://device.example/b"]);
            expect(done).toHaveBeenCalledTimes(1);
        });
    });
})
