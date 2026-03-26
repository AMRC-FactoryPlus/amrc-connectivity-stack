import { describe, it, expect, vi } from "vitest";
import Queries from "../lib/queries.js";

describe("cleanup_old_sessions", () => {
    it("issues a delete for non-current sessions by session id", async () => {
        const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
        const q = new Queries(mockQuery);

        await q.cleanup_old_sessions(42);

        expect(mockQuery).toHaveBeenCalledOnce();
        const [sql, params] = mockQuery.mock.calls[0];
        expect(sql).toMatch(/delete from session/i);
        expect(sql).toMatch(/next_for_device is not null/i);
        expect(params).toEqual([42]);
    });
});

describe("session_notification_info", () => {
    it("returns session info with prev_for_device", async () => {
        const row = {
            device: "uuid-1",
            group_id: "G",
            node_id: "N",
            device_id: "D",
            next_for_device: null,
            next_for_address: null,
            prev_for_device: 10,
        };
        const mockQuery = vi.fn().mockResolvedValue({ rows: [row] });
        const q = new Queries(mockQuery);

        const result = await q.session_notification_info(42);

        expect(result).toEqual(row);
        expect(result.prev_for_device).toBe(10);
    });
});
