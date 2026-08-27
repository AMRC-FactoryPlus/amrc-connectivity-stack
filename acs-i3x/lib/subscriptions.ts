/*
 * SubscriptionManager — Manages i3X subscriptions supporting SSE
 * streaming and sync polling with TTL-based cleanup.
 */

import { randomUUID } from "crypto";
import type { I3xVqt, I3xSubscription, I3xSyncItem } from "./types/i3x.js";

interface ValueCacheLike {
    onValueChange(listener: (elementId: string, vqt: I3xVqt) => void): void;
    offValueChange(listener: (elementId: string, vqt: I3xVqt) => void): void;
}

interface SubscriptionManagerOpts {
    valueCache: ValueCacheLike;
    ttl: number;
}

interface Subscription {
    /* The authenticated Factory+ principal which created the
     * subscription. This is what ownership is checked against; it is
     * never supplied by the client and is never sent on the wire. */
    owner: string;
    /* The client's own handle for itself. Part of the i3X wire shape,
     * so we store and echo it, but it protects nothing. */
    clientId: string;
    subscriptionId: string;
    displayName: string;
    registeredElements: Map<string, number>; // elementId -> maxDepth
    queue: I3xSyncItem[];
    nextSequenceNumber: number;
    activeStream: any | null;
    lastAccessed: number;
    ttlTimer: ReturnType<typeof setTimeout>;
}

export class SubscriptionManager {
    private valueCache: ValueCacheLike;
    private ttl: number;
    private subscriptions: Map<string, Subscription> = new Map();
    private boundOnValueChange: (elementId: string, vqt: I3xVqt) => void;

    constructor(opts: SubscriptionManagerOpts) {
        this.valueCache = opts.valueCache;
        this.ttl = opts.ttl;
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
            queue: [],
            nextSequenceNumber: 1,
            activeStream: null,
            lastAccessed: Date.now(),
            ttlTimer: setTimeout(() => this.expireSubscription(subscriptionId), this.ttl),
        };

        this.subscriptions.set(subscriptionId, sub);

        return {
            clientId: sub.clientId,
            subscriptionId: sub.subscriptionId,
            displayName: sub.displayName,
        };
    }

    list(owner: string, subscriptionIds: string[]): I3xSubscription[] {
        const results: I3xSubscription[] = [];
        for (const id of subscriptionIds) {
            const sub = this.subscriptions.get(id);
            if (sub && owner && sub.owner === owner) {
                results.push({
                    clientId: sub.clientId,
                    subscriptionId: sub.subscriptionId,
                    displayName: sub.displayName,
                });
            }
        }
        return results;
    }

    getOne(owner: string, subscriptionId: string): I3xSubscription {
        const sub = this.getAndVerify(owner, subscriptionId);

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

    deleteOne(owner: string, subscriptionId: string): void {
        const sub = this.getAndVerify(owner, subscriptionId);

        clearTimeout(sub.ttlTimer);
        if (sub.activeStream) {
            sub.activeStream.end();
            sub.activeStream = null;
        }
        this.subscriptions.delete(subscriptionId);
    }

    register(owner: string, subscriptionId: string, elementIds: string[], maxDepth: number = 1): void {
        const sub = this.getAndVerify(owner, subscriptionId);

        for (const elementId of elementIds) {
            sub.registeredElements.set(elementId, maxDepth);
        }

        console.log(`[SUB] register: sub=${subscriptionId.slice(0,8)} elements=[${elementIds.join(", ")}] maxDepth=${maxDepth}`);
        this.resetTtl(sub);
    }

    registerOne(owner: string, subscriptionId: string, elementId: string, maxDepth: number = 1): void {
        const sub = this.getAndVerify(owner, subscriptionId);
        sub.registeredElements.set(elementId, maxDepth);
        console.log(`[SUB] register: sub=${subscriptionId.slice(0,8)} element=${elementId} maxDepth=${maxDepth}`);
        this.resetTtl(sub);
    }

    unregister(owner: string, subscriptionId: string, elementIds: string[]): void {
        const sub = this.getAndVerify(owner, subscriptionId);

        for (const elementId of elementIds) {
            sub.registeredElements.delete(elementId);
        }

        this.resetTtl(sub);
    }

    unregisterOne(owner: string, subscriptionId: string, elementId: string): void {
        const sub = this.getAndVerify(owner, subscriptionId);
        sub.registeredElements.delete(elementId);
        this.resetTtl(sub);
    }

    sync(owner: string, subscriptionId: string, lastSequenceNumber?: number): I3xSyncItem[] {
        const sub = this.getAndVerify(owner, subscriptionId);

        if (lastSequenceNumber !== undefined) {
            sub.queue = sub.queue.filter(item => item.sequenceNumber > lastSequenceNumber);
        }

        this.resetTtl(sub);
        return [...sub.queue];
    }

    stream(owner: string, subscriptionId: string, res: any): void {
        const sub = this.getAndVerify(owner, subscriptionId);

        if (sub.activeStream) {
            throw new Error(`Subscription ${subscriptionId} already has an active stream`);
        }

        console.log(`[SSE] stream opened: sub=${subscriptionId.slice(0,8)} registered=[${[...sub.registeredElements.keys()].map(k => k.slice(0,8)).join(", ")}] queued=${sub.queue.length}`);

        // Set SSE headers
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        sub.activeStream = res;

        // Flush any queued items
        if (sub.queue.length > 0) {
            console.log(`[SSE] flushing ${sub.queue.length} queued items`);
        }
        for (const item of sub.queue) {
            this.writeSseEvent(res, item);
        }

        // Handle close
        res.on("close", () => {
            console.log(`[SSE] stream closed: sub=${subscriptionId.slice(0,8)}`);
            sub.activeStream = null;
        });

        this.resetTtl(sub);
    }

    destroy(): void {
        for (const [id, sub] of this.subscriptions) {
            clearTimeout(sub.ttlTimer);
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

            const item: I3xSyncItem = {
                sequenceNumber: sub.nextSequenceNumber++,
                elementId,
                ...vqt,
            };
            sub.queue.push(item);

            if (sub.activeStream) {
                console.log(`[SSE] writing seq=${item.sequenceNumber} to sub=${sub.subscriptionId.slice(0,8)} element=${elementId.slice(0,8)} value=${JSON.stringify(vqt.value)}`);
                this.writeSseEvent(sub.activeStream, item);
            } else {
                console.log(`[SSE] queued seq=${item.sequenceNumber} for sub=${sub.subscriptionId.slice(0,8)} element=${elementId.slice(0,8)} (no active stream)`);
            }
        }
    }

    private writeSseEvent(res: any, item: I3xSyncItem): void {
        // SSE events use the same VQT shape as the spec — no sequenceNumber
        const { sequenceNumber, ...vqt } = item;
        const data = `data: ${JSON.stringify([vqt])}\n\n`;
        const ok = res.write(data);
        // Ensure the chunk is flushed to the client immediately
        if (typeof res.flush === "function") res.flush();
        if (!ok) {
            // Back-pressure: drain event will allow more writes
            res.once("drain", () => {});
        }
    }

    /* Ownership is checked against the authenticated principal, not
     * against the client-supplied clientId. A subscription owned by
     * someone else reports 404, identically to one that does not
     * exist, so that the pair cannot be used to probe which
     * subscription ids are live. acs-directory does the same thing for
     * alerts, deliberately, for the same reason.
     *
     * A falsy `owner` means the request reached us unauthenticated.
     * That should be impossible — every subscription route sits behind
     * FplusHttpAuth — but it fails closed here rather than matching a
     * subscription stored with a falsy owner. */
    private getAndVerify(owner: string, subscriptionId: string): Subscription {
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub || !owner || sub.owner !== owner) {
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

    private expireSubscription(subscriptionId: string): void {
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub) return;

        clearTimeout(sub.ttlTimer);
        if (sub.activeStream) {
            sub.activeStream.end();
            sub.activeStream = null;
        }
        sub.queue.length = 0;
        this.subscriptions.delete(subscriptionId);
    }
}
