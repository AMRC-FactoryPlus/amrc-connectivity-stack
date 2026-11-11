/*
 * SubscriptionManager — Manages i3X subscriptions supporting SSE
 * streaming and sync polling with TTL-based cleanup.
 *
 * A subscription is in one of two delivery modes at any moment. While
 * an SSE stream is attached, changes are written to the stream and are
 * not queued: streaming is at-most-once, so there is nothing to keep.
 * While no stream is attached, changes are queued for /sync (or for the
 * next stream to open), up to `maxQueue` items, oldest dropped first.
 *
 * /sync hands the queue out in batches, as i3X 1.0 defines it. The
 * changes since the previous /sync become one batch with the next
 * sequence number, and a batch is sent again on every /sync until the
 * client acknowledges its number.
 */

import { randomUUID } from "crypto";
import type { I3xVqt, I3xSubscription, I3xSyncBatch, I3xSyncItem } from "./types/i3x.js";
import type { Viewer } from "./access.js";

interface ValueCacheLike {
    onValueChange(listener: (elementId: string, vqt: I3xVqt) => void): void;
    offValueChange(listener: (elementId: string, vqt: I3xVqt) => void): void;
}

interface SubscriptionManagerOpts {
    valueCache: ValueCacheLike;
    /** What each owner may see, followed live (Access). Updates for
     * objects the owner cannot see are not delivered. */
    viewers: { track(owner: string): Viewer };
    ttl: number;
    /**
     * Most updates a subscription queues while no stream is open. When
     * full the oldest is dropped, and the next /sync reports the loss
     * with HTTP 206. Default 10,000.
     */
    maxQueue?: number;
    log?: (msg: string, ...args: any[]) => void;
}

export interface SyncResult {
    batches: I3xSyncBatch[];
    /* Updates dropped from the queue since the previous /sync. */
    dropped: number;
}

interface Subscription {
    /* The authenticated Factory+ principal which created the
     * subscription. This is what ownership is checked against; it is
     * never supplied by the client and is never sent on the wire. */
    owner: string;
    /* The client's own handle for itself, which i3X scopes the
     * subscription to: a request must give the clientId the
     * subscription was created with. It is a second check, never a
     * substitute for `owner`. */
    clientId: string;
    subscriptionId: string;
    displayName: string;
    registeredElements: Map<string, number>; // elementId -> maxDepth
    /** Batches a /sync has returned and the client has not yet
     * acknowledged, oldest first. */
    batches: I3xSyncBatch[];
    /** Changes since the last /sync, oldest first: the next batch. */
    staged: I3xSyncItem[];
    /** Updates dropped from the front of a full queue since the last
     * /sync reported them or a stream opened. */
    dropped: number;
    nextSequenceNumber: number;
    activeStream: any | null;
    lastAccessed: number;
    ttlTimer: ReturnType<typeof setTimeout>;
    viewer: Viewer;
}

export class SubscriptionManager {
    private valueCache: ValueCacheLike;
    private viewers: { track(owner: string): Viewer };
    private ttl: number;
    private maxQueue: number;
    private log: (msg: string, ...args: any[]) => void;
    private subscriptions: Map<string, Subscription> = new Map();
    private boundOnValueChange: (elementId: string, vqt: I3xVqt) => void;

    constructor(opts: SubscriptionManagerOpts) {
        this.valueCache = opts.valueCache;
        this.viewers = opts.viewers;
        this.ttl = opts.ttl;
        this.maxQueue = Math.max(1, opts.maxQueue ?? 10_000);
        this.log = opts.log ?? (() => {});
        this.boundOnValueChange = this.onValueChange.bind(this);
        this.valueCache.onValueChange(this.boundOnValueChange);
    }

    /* `owner` is the authenticated principal (`req.auth`); `clientId`
     * is the client-supplied i3X handle. Only `owner` grants access to
     * the subscription afterwards. */
    create(owner: string, clientId: string, displayName?: string): I3xSubscription {
        const subscriptionId = randomUUID();
        const sub: Subscription = {
            owner,
            clientId,
            subscriptionId,
            displayName: displayName ?? "",
            registeredElements: new Map(),
            batches: [],
            staged: [],
            dropped: 0,
            nextSequenceNumber: 1,
            activeStream: null,
            lastAccessed: Date.now(),
            ttlTimer: setTimeout(() => this.expireSubscription(subscriptionId), this.ttl),
            viewer: this.viewers.track(owner),
        };

        this.subscriptions.set(subscriptionId, sub);

        return {
            clientId: sub.clientId,
            subscriptionId: sub.subscriptionId,
            displayName: sub.displayName,
        };
    }

    list(owner: string, clientId: string, subscriptionIds: string[]): I3xSubscription[] {
        const results: I3xSubscription[] = [];
        for (const id of subscriptionIds) {
            const sub = this.subscriptions.get(id);
            if (sub && owner && sub.owner === owner && sub.clientId === clientId) {
                results.push({
                    clientId: sub.clientId,
                    subscriptionId: sub.subscriptionId,
                    displayName: sub.displayName,
                });
            }
        }
        return results;
    }

    /** Updates dropped from a subscription's full queue since the
     * last /sync or stream open. */
    droppedCount(owner: string, clientId: string, subscriptionId: string): number {
        return this.getAndVerify(owner, clientId, subscriptionId).dropped;
    }

    getOne(owner: string, clientId: string, subscriptionId: string): I3xSubscription {
        const sub = this.getAndVerify(owner, clientId, subscriptionId);

        const monitoredObjects = [...sub.registeredElements.entries()]
            .map(([elementId, maxDepth]) => ({ elementId, maxDepth }));

        this.resetTtl(sub);

        return {
            clientId: sub.clientId,
            subscriptionId: sub.subscriptionId,
            displayName: sub.displayName,
            monitoredObjects,
        };
    }

    deleteOne(owner: string, clientId: string, subscriptionId: string): void {
        const sub = this.getAndVerify(owner, clientId, subscriptionId);

        clearTimeout(sub.ttlTimer);
        sub.viewer.stop();
        if (sub.activeStream) {
            sub.activeStream.end();
            sub.activeStream = null;
        }
        this.subscriptions.delete(subscriptionId);
    }

    register(owner: string, clientId: string, subscriptionId: string, elementIds: string[], maxDepth: number = 1): void {
        const sub = this.getAndVerify(owner, clientId, subscriptionId);

        for (const elementId of elementIds) {
            sub.registeredElements.set(elementId, maxDepth);
        }

        this.log("register: sub=%s elements=%d maxDepth=%d", subscriptionId.slice(0, 8), elementIds.length, maxDepth);
        this.resetTtl(sub);
    }

    /* Registering an object a second time succeeds and changes
     * nothing but its depth. */
    registerOne(owner: string, clientId: string, subscriptionId: string, elementId: string, maxDepth: number = 1): void {
        const sub = this.getAndVerify(owner, clientId, subscriptionId);
        sub.registeredElements.set(elementId, maxDepth);
        this.log("register: sub=%s element=%s maxDepth=%d", subscriptionId.slice(0, 8), elementId, maxDepth);
        this.resetTtl(sub);
    }

    unregister(owner: string, clientId: string, subscriptionId: string, elementIds: string[]): void {
        const sub = this.getAndVerify(owner, clientId, subscriptionId);

        for (const elementId of elementIds) {
            sub.registeredElements.delete(elementId);
        }

        this.resetTtl(sub);
    }

    unregisterOne(owner: string, clientId: string, subscriptionId: string, elementId: string): void {
        const sub = this.getAndVerify(owner, clientId, subscriptionId);
        sub.registeredElements.delete(elementId);
        this.resetTtl(sub);
    }

    /* `lastSequenceNumber` acknowledges every batch at or below it;
     * -1 acknowledges every batch sent so far. Anything else that is
     * not a non-negative integer is ignored and clears nothing, as the
     * spec requires. The changes since the previous sync then become a
     * new batch, and every batch not yet acknowledged is returned, so
     * a client that lost a response gets its batch again. Sync is
     * refused while a stream is open: the stream owns delivery and the
     * queue is empty. */
    sync(owner: string, clientId: string, subscriptionId: string, lastSequenceNumber?: number): SyncResult {
        const sub = this.getAndVerify(owner, clientId, subscriptionId);

        if (sub.activeStream) {
            const err: any = new Error(
                `Subscription ${subscriptionId} has an open stream; close it before calling sync`);
            err.status = 409;
            throw err;
        }

        if (lastSequenceNumber === -1) {
            sub.batches = [];
        } else if (Number.isInteger(lastSequenceNumber) && lastSequenceNumber! >= 0) {
            sub.batches = sub.batches.filter(b => b.sequenceNumber > lastSequenceNumber!);
        }

        const dropped = sub.dropped;
        sub.dropped = 0;

        if (sub.staged.length > 0) {
            sub.batches.push({ sequenceNumber: sub.nextSequenceNumber++, updates: sub.staged });
            sub.staged = [];
        }

        this.resetTtl(sub);
        /* Access may have been revoked since these were queued. */
        const batches: I3xSyncBatch[] = [];
        for (const b of sub.batches) {
            const updates = b.updates.filter(item => sub.viewer.visible(item.elementId));
            if (updates.length > 0) batches.push({ sequenceNumber: b.sequenceNumber, updates });
        }
        return { batches, dropped };
    }

    /* Only one stream per subscription: a new stream closes the
     * existing one cleanly and takes over. The queue built up while no
     * stream was attached is sent on the new stream and then released;
     * from here until the stream closes, nothing is queued. */
    stream(owner: string, clientId: string, subscriptionId: string, res: any): void {
        const sub = this.getAndVerify(owner, clientId, subscriptionId);

        if (sub.activeStream) {
            this.log("replacing existing stream: sub=%s", subscriptionId.slice(0, 8));
            sub.activeStream.end();
            sub.activeStream = null;
        }

        const queued = [...sub.batches.flatMap(b => b.updates), ...sub.staged];
        this.log("stream opened: sub=%s registered=%d queued=%d dropped=%d", subscriptionId.slice(0, 8), sub.registeredElements.size, queued.length, sub.dropped);

        // Set SSE headers
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        sub.activeStream = res;

        // Flush any queued items
        if (queued.length > 0) {
            this.log("flushing %d queued items", queued.length);
        }
        for (const item of queued) {
            if (sub.viewer.visible(item.elementId)) this.writeSseEvent(res, item);
        }
        sub.batches = [];
        sub.staged = [];
        sub.dropped = 0;

        // Handle close
        res.on("close", () => {
            this.log("stream closed: sub=%s", subscriptionId.slice(0, 8));
            /* A stream replaced by a newer one must not detach its
             * successor, and a deleted subscription must not get a
             * fresh TTL timer. */
            if (sub.activeStream !== res) return;
            sub.activeStream = null;
            /* The TTL counts from when the stream went away. */
            if (this.subscriptions.get(subscriptionId) === sub)
                this.resetTtl(sub);
        });

        this.resetTtl(sub);
    }

    destroy(): void {
        for (const [id, sub] of this.subscriptions) {
            clearTimeout(sub.ttlTimer);
            sub.viewer.stop();
            if (sub.activeStream) {
                sub.activeStream.end();
                sub.activeStream = null;
            }
        }
        this.subscriptions.clear();
        this.valueCache.offValueChange(this.boundOnValueChange);
    }

    /* ---- Private methods ---- */

    private onValueChange(elementId: string, vqt: I3xVqt): void {
        if (this.subscriptions.size === 0) return;

        for (const sub of this.subscriptions.values()) {
            if (!sub.registeredElements.has(elementId)) continue;
            if (!sub.viewer.visible(elementId)) continue;

            if (sub.activeStream) {
                this.writeSseEvent(sub.activeStream, { elementId, ...vqt });
                continue;
            }

            /* The queue is kept until the client syncs past it, so a
             * client that never does would grow it without limit. */
            if (this.queued(sub) >= this.maxQueue) this.dropOldest(sub);
            sub.staged.push({ elementId, ...vqt });
        }
    }

    /** Updates held for /sync: sent and not acknowledged, or not yet
     * sent. */
    private queued(sub: Subscription): number {
        let n = sub.staged.length;
        for (const b of sub.batches) n += b.updates.length;
        return n;
    }

    /** Drop the oldest queued update, which is in the oldest batch not
     * yet acknowledged if there is one. */
    private dropOldest(sub: Subscription): void {
        const oldest = sub.batches[0];
        if (oldest) {
            oldest.updates.shift();
            if (oldest.updates.length === 0) sub.batches.shift();
        } else {
            sub.staged.shift();
        }
        sub.dropped++;
    }

    private writeSseEvent(res: any, item: I3xSyncItem): void {
        // SSE events are the update itself: there is nothing to acknowledge.
        const data = `data: ${JSON.stringify([item])}\n\n`;
        const ok = res.write(data);
        // Ensure the chunk is flushed to the client immediately
        if (typeof res.flush === "function") res.flush();
        if (!ok) {
            // Back-pressure: drain event will allow more writes
            res.once("drain", () => {});
        }
    }

    /* Ownership is checked against the authenticated principal. The
     * clientId the subscription was created with must match as well,
     * as i3X requires, but it is supplied by the client and guards
     * nothing by itself. A subscription owned by someone else, or
     * asked for with another clientId, reports 404, identically to one
     * that does not exist, so that neither can be used to probe which
     * subscription ids are live. acs-directory does the same thing for
     * alerts, deliberately, for the same reason.
     *
     * A falsy `owner` means the request reached us unauthenticated.
     * That should be impossible — every subscription route sits behind
     * FplusHttpAuth — but it fails closed here rather than matching a
     * subscription stored with a falsy owner. */
    private getAndVerify(owner: string, clientId: string, subscriptionId: string): Subscription {
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub || !owner || sub.owner !== owner || sub.clientId !== clientId) {
            const err: any = new Error(`Subscription ${subscriptionId} not found`);
            err.status = 404;
            throw err;
        }
        return sub;
    }

    private resetTtl(sub: Subscription): void {
        clearTimeout(sub.ttlTimer);
        sub.lastAccessed = Date.now();
        sub.ttlTimer = setTimeout(
            () => this.expireSubscription(sub.subscriptionId),
            this.ttl,
        );
    }

    /* The spec expires a subscription only when it has had neither an
     * active stream nor a /sync for a whole TTL. An open stream keeps
     * it alive; the timer restarts when the stream closes. */
    private expireSubscription(subscriptionId: string): void {
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub) return;
        if (sub.activeStream) {
            this.resetTtl(sub);
            return;
        }

        clearTimeout(sub.ttlTimer);
        sub.viewer.stop();
        sub.batches = [];
        sub.staged = [];
        this.subscriptions.delete(subscriptionId);
    }
}
