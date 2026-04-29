/*
 * i3X response envelope middleware
 *
 * Provides two Express middleware functions:
 * - i3xEnvelope: wraps successful responses in { success: true, result: data }
 * - i3xErrorHandler: catches errors and returns { success: false, error: { message } }
 */

import type { Request, Response, NextFunction } from "express";

/**
 * Monkey-patches res.json so that route handlers' responses are
 * automatically wrapped in the i3X success envelope.
 */
export function i3xEnvelope (req: Request, res: Response, next: NextFunction): void {
    const originalJson = res.json.bind(res);

    /* Store the original for use by the error handler */
    (res as any)._originalJson = originalJson;

    res.json = ((data: any) => {
        return originalJson({ success: true, result: data });
    }) as any;

    next();
}

/**
 * Express error-handling middleware (4 parameters).
 * Returns an i3X error envelope without double-wrapping.
 */
export function i3xErrorHandler (err: any, req: Request, res: Response, next: NextFunction): void {
    const status: number = err.status || 500;
    const message: string = err.message || "Internal server error";

    res.status(status);

    /* Use the original json method to avoid double-wrapping by i3xEnvelope */
    const json = (res as any)._originalJson || res.json.bind(res);
    json({ success: false, error: { message } });
}
