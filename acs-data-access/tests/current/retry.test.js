import { describe, expect, test, vi } from "vitest";

import { APIError } from "@amrc-factoryplus/service-api";
import { ServiceError } from "@amrc-factoryplus/service-client";

import { MAX_RETRIES, is_transient_error, retry_cdb_write }
    from "../../lib/retry.js";
import { SessionLimitsHandler } from "../../lib/session-limits-handler.js";
import { UnionComponentsHandler } from "../../lib/unions-components-handler.js";

const SERVICE = "af15f175-78a0-4e05-97c0-2a0bb82b9f3b";
const DATASET = "e2a4c530-dc0f-417d-b00b-329b0e90e033";
const SOURCE = "1f2b8d1a-4b53-4c9a-9c0d-9a1c2e3f4a5b";

/* Keep the backoff short so the tests run quickly. The production
 * delay is RETRY_DELAY. */
const FAST = { delay: 1 };

function cdb_error (status) {
    return new ServiceError(SERVICE, "ConfigDB says no", status);
}

/* Capture the outcome of a promise without try/catch in every test. */
function settle (promise) {
    return promise.then(
        value => ({ ok: true, value }),
        error => ({ ok: false, error }));
}

function write (opts) {
    return settle(retry_cdb_write({
        log: () => {}, dataset: DATASET, what: "add subclass",
        ...FAST, ...opts,
    }));
}

function fake_handler (Handler, cdb) {
    return new Handler({ auth: null, cdb, log: () => {} });
}

describe("is_transient_error", () => {
    test.for([400, 401, 403, 404, 409, 422, 499])
        ("treats %i as permanent", st => {
            expect(is_transient_error(cdb_error(st))).toBe(false);
        });

    test.for([500, 502, 503, 504])
        ("treats %i as transient", st => {
            expect(is_transient_error(cdb_error(st))).toBe(true);
        });

    test("treats a connection failure as transient", () => {
        expect(is_transient_error(cdb_error(0))).toBe(true);
    });

    test("treats an error with no status as transient", () => {
        expect(is_transient_error(new Error("boom"))).toBe(true);
    });
});

describe("retry_cdb_write", () => {
    test("does not retry a 403", async () => {
        const op = vi.fn().mockRejectedValue(cdb_error(403));

        const res = await write({ op });

        expect(op).toHaveBeenCalledTimes(1);
        expect(res.ok).toBe(false);
        expect(res.error).toBeInstanceOf(APIError);
        expect(res.error.status).toBe(403);
    });

    test("does not retry a 404", async () => {
        const op = vi.fn().mockRejectedValue(cdb_error(404));

        const res = await write({ op });

        expect(op).toHaveBeenCalledTimes(1);
        expect(res.error.status).toBe(404);
    });

    test("succeeds without retrying", async () => {
        const op = vi.fn().mockResolvedValue(undefined);

        const res = await write({ op });

        expect(op).toHaveBeenCalledTimes(1);
        expect(res.ok).toBe(true);
    });

    test("retries a 503 and succeeds", async () => {
        const op = vi.fn()
            .mockRejectedValueOnce(cdb_error(503))
            .mockRejectedValueOnce(cdb_error(503))
            .mockResolvedValue(undefined);

        const res = await write({ op });

        expect(op).toHaveBeenCalledTimes(3);
        expect(res.ok).toBe(true);
    });

    test("caps the attempts when a 503 never clears", async () => {
        const op = vi.fn().mockRejectedValue(cdb_error(503));

        const res = await write({ op });

        expect(op).toHaveBeenCalledTimes(MAX_RETRIES + 1);
        expect(res.ok).toBe(false);
        expect(res.error).toBeInstanceOf(APIError);
        expect(res.error.status).toBe(503);
    });

    test("caps the attempts when the connection never comes back",
        async () => {
            const op = vi.fn().mockRejectedValue(cdb_error(0));

            const res = await write({ op });

            expect(op).toHaveBeenCalledTimes(MAX_RETRIES + 1);
            expect(res.error.status).toBe(503);
        });

    test("caps the attempts for an error with no status", async () => {
        const op = vi.fn().mockRejectedValue(new Error("boom"));

        const res = await write({ op });

        expect(op).toHaveBeenCalledTimes(MAX_RETRIES + 1);
        expect(res.error.status).toBe(500);
    });

    test("logs the dataset and the status when it gives up", async () => {
        const log = vi.fn();
        const op = vi.fn().mockRejectedValue(cdb_error(403));

        await write({ log, op });

        const failure = log.mock.calls.at(-1).join(" ");
        expect(failure).toContain(DATASET);
        expect(failure).toContain("403");
    });
});

describe("handlers", () => {
    test("SessionLimits create does not retry a 403", async () => {
        const cdb = {
            class_add_subclass: vi.fn().mockRejectedValue(cdb_error(403)),
        };
        const handler = fake_handler(SessionLimitsHandler, cdb);

        const res = await settle(handler.create_subclass_relationships(
            DATASET, { source: SOURCE }));

        expect(cdb.class_add_subclass).toHaveBeenCalledTimes(1);
        expect(cdb.class_add_subclass).toHaveBeenCalledWith(SOURCE, DATASET);
        expect(res.error).toBeInstanceOf(APIError);
        expect(res.error.status).toBe(403);
    });

    test("SessionLimits remove does not retry a 403", async () => {
        const cdb = {
            class_remove_subclass: vi.fn().mockRejectedValue(cdb_error(403)),
        };
        const handler = fake_handler(SessionLimitsHandler, cdb);

        const res = await settle(handler.remove_subclass_relationships(
            DATASET, { source: SOURCE }));

        expect(cdb.class_remove_subclass).toHaveBeenCalledTimes(1);
        expect(res.error.status).toBe(403);
    });

    test("UnionComponents create does not retry a 403", async () => {
        const cdb = {
            class_add_subclass: vi.fn().mockRejectedValue(cdb_error(403)),
        };
        const handler = fake_handler(UnionComponentsHandler, cdb);

        const res = await settle(handler.create_subclass_relationships(
            DATASET, [SOURCE]));

        expect(cdb.class_add_subclass).toHaveBeenCalledTimes(1);
        expect(res.error.status).toBe(403);
    });

    test("UnionComponents create stops at the first bad source",
        async () => {
            const other = "3c4d5e6f-7a8b-49c0-8d1e-2f3a4b5c6d7e";
            const cdb = {
                class_add_subclass: vi.fn()
                    .mockRejectedValue(cdb_error(403)),
            };
            const handler = fake_handler(UnionComponentsHandler, cdb);

            const res = await settle(handler.create_subclass_relationships(
                DATASET, [SOURCE, other]));

            expect(cdb.class_add_subclass).toHaveBeenCalledTimes(1);
            expect(res.ok).toBe(false);
        });

    test("UnionComponents remove does not retry a 403", async () => {
        const cdb = {
            class_remove_subclass: vi.fn().mockRejectedValue(cdb_error(403)),
        };
        const handler = fake_handler(UnionComponentsHandler, cdb);

        const res = await settle(handler.remove_subclass_relationships(
            DATASET, [SOURCE]));

        expect(cdb.class_remove_subclass).toHaveBeenCalledTimes(1);
        expect(res.error.status).toBe(403);
    });
});
