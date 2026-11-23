/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Writes a subscription's updates to its SSE response.
 *
 * Updates are sent in one write per turn of the event loop, not one
 * write each. i3X requires a gzip response when the client asks for
 * one, so the stream goes through a zlib stream, and a zlib stream
 * takes one write per turn. One write per update could then only send
 * a few dozen updates a second while other requests kept the loop
 * busy, and live values fell behind for as long as that work lasted.
 * One write per turn carries everything that arrived during the turn.
 *
 * A client that reads slower than updates arrive, or stops reading,
 * fills the socket and then the zlib stream, and the write returns
 * false. From then until the response drains, each element keeps only
 * its newest update. Streaming is at-most-once, so the older ones can
 * go, and the client still ends up with every element's latest value.
 * What is held is bounded by the number of elements the subscription
 * delivers, however long the client takes.
 */

import type { I3xSyncItem } from "./types/i3x.js";

export class SseStream {
    readonly res: any;
    /** Updates superseded while the client was not reading. */
    superseded = 0;

    private pending: I3xSyncItem[] = [];
    private held: Map<string, I3xSyncItem> = new Map();
    private scheduled = false;
    private blocked = false;
    private closed = false;
    private schedule: (fn: () => void) => void;

    /** `schedule` runs the write for a turn; the default is the end
     * of this one. */
    constructor(res: any, schedule: (fn: () => void) => void = setImmediate) {
        this.res = res;
        this.schedule = schedule;
    }

    send(item: I3xSyncItem): void {
        if (this.closed) return;
        if (this.blocked) {
            if (this.held.delete(item.elementId)) this.superseded++;
            this.held.set(item.elementId, item);
            return;
        }
        this.pending.push(item);
        if (this.scheduled) return;
        this.scheduled = true;
        this.schedule(() => this.flush());
    }

    /** End the response. Anything not yet written is dropped. */
    end(): void {
        this.close();
        this.res.end();
    }

    /** The response has closed: drop anything not yet written and
     * write nothing more. */
    close(): void {
        this.closed = true;
        this.pending = [];
        this.held.clear();
    }

    private flush(): void {
        this.scheduled = false;
        if (this.closed || this.blocked || this.pending.length === 0) return;

        // SSE events are the update itself: there is nothing to acknowledge.
        let data = "";
        for (const item of this.pending)
            data += `data: ${JSON.stringify([item])}\n\n`;
        this.pending = [];

        const ok = this.res.write(data);
        // Send it now rather than when zlib's buffer fills.
        if (typeof this.res.flush === "function") this.res.flush();
        if (ok !== false) return;

        this.blocked = true;
        this.res.once("drain", () => this.resume());
    }

    private resume(): void {
        this.blocked = false;
        if (this.closed) return;
        this.pending = [...this.held.values()];
        this.held.clear();
        this.flush();
    }
}
