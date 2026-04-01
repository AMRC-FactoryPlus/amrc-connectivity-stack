import { i3xEnvelope, i3xErrorHandler } from "../src/middleware/envelope.js";
import type { Request, Response, NextFunction } from "express";

function mockRes() {
    const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        headersSent: false,
    };
    return res;
}

function mockReq() {
    return {} as Request;
}

function mockNext(): NextFunction {
    return jest.fn() as unknown as NextFunction;
}

describe("i3xEnvelope", () => {
    it("wraps an object in a success envelope", () => {
        const res = mockRes();
        const originalJson = res.json;
        const next = mockNext();

        i3xEnvelope(mockReq(), res, next);

        expect(next).toHaveBeenCalled();

        res.json({ foo: "bar" });

        expect(originalJson).toHaveBeenCalledWith({
            success: true,
            result: { foo: "bar" },
        });
    });

    it("wraps an array in a success envelope", () => {
        const res = mockRes();
        const originalJson = res.json;
        const next = mockNext();

        i3xEnvelope(mockReq(), res, next);
        res.json([1, 2, 3]);

        expect(originalJson).toHaveBeenCalledWith({
            success: true,
            result: [1, 2, 3],
        });
    });

    it("wraps null in a success envelope", () => {
        const res = mockRes();
        const originalJson = res.json;
        const next = mockNext();

        i3xEnvelope(mockReq(), res, next);
        res.json(null);

        expect(originalJson).toHaveBeenCalledWith({
            success: true,
            result: null,
        });
    });

    it("calls next to pass control to the next middleware", () => {
        const res = mockRes();
        const next = mockNext();

        i3xEnvelope(mockReq(), res, next);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

describe("i3xErrorHandler", () => {
    it("returns 404 with correct error envelope", () => {
        const res = mockRes();
        const next = mockNext();
        const err: any = new Error("Not Found");
        err.status = 404;

        i3xErrorHandler(err, mockReq(), res, next);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { message: "Not Found" },
        });
    });

    it("returns 403 with correct error envelope", () => {
        const res = mockRes();
        const next = mockNext();
        const err: any = new Error("Forbidden");
        err.status = 403;

        i3xErrorHandler(err, mockReq(), res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { message: "Forbidden" },
        });
    });

    it("defaults to 500 when error has no status", () => {
        const res = mockRes();
        const next = mockNext();
        const err = new Error("something broke");

        i3xErrorHandler(err, mockReq(), res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { message: "something broke" },
        });
    });

    it("defaults message to 'Internal server error' when error has no message", () => {
        const res = mockRes();
        const next = mockNext();
        const err: any = { status: 500 };

        i3xErrorHandler(err, mockReq(), res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { message: "Internal server error" },
        });
    });

    it("uses status from an APIError-like object", () => {
        const res = mockRes();
        const next = mockNext();
        /* Simulate an APIError from @amrc-factoryplus/service-api */
        const err: any = new Error("Bad Request");
        err.status = 400;

        i3xErrorHandler(err, mockReq(), res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { message: "Bad Request" },
        });
    });

    it("does not double-wrap when envelope middleware is active", () => {
        const res = mockRes();
        const originalJson = res.json;
        const next = mockNext();

        /* Apply the envelope middleware first, which replaces res.json */
        i3xEnvelope(mockReq(), res, next);

        const err: any = new Error("Not Found");
        err.status = 404;

        i3xErrorHandler(err, mockReq(), res, next);

        /* The error handler should call the ORIGINAL res.json (the mock),
         * not the wrapped version. The original mock should have been called
         * with the raw error envelope, not wrapped in { success: true, ... }. */
        const lastCall = originalJson.mock.calls[originalJson.mock.calls.length - 1][0];
        expect(lastCall).toEqual({
            success: false,
            error: { message: "Not Found" },
        });
    });
});
