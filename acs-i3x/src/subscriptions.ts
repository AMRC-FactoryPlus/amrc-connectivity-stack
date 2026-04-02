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

    create(clientId: string, displayName?: string): I3xSubscription {
        const subscriptionId = randomUUID();
        const sub: Subscription = {
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

    list(clientId: string, subscriptionIds: string[]): I3xSubscription[] {
        const results: I3xSubscription[] = [];
        for (const id of subscriptionIds) {
            const sub = this.subscriptions.get(id);
            if (sub && sub.clientId === clientId) {
                results.push({
                    clientId: sub.clientId,
                    subscriptionId: sub.subscriptionId,
                    displayName: sub.displayName,
                });
            }
        }
        return results;
    }

    delete(clientId: string, subscriptionIds: string[]): void {
        for (const id of subscriptionIds) {
            const sub = this.subscriptions.get(id);
            if (!sub || sub.clientId !== clientId) continue;

            clearTimeout(sub.ttlTimer);
            if (sub.activeStream) {
                sub.activeStream.end();
                sub.activeStream = null;
            }
            this.subscriptions.delete(id);
        }
    }

    register(clientId: string, subscriptionId: string, elementIds: string[], maxDepth: number = 1): void {
        const sub = this.getAndVerify(clientId, subscriptionId);

        for (const elementId of elementIds) {
            sub.registeredElements.set(elementId, maxDepth);
        }

        console.log(`[SUB] register: sub=${subscriptionId.slice(0,8)} elements=[${elementIds.join(", ")}] maxDepth=${maxDepth}`);
        this.resetTtl(sub);
    }

    unregister(clientId: string, subscriptionId: string, elementIds: string[]): void {
        const sub = this.getAndVerify(clientId, subscriptionId);

        for (const elementId of elementIds) {
            sub.registeredElements.delete(elementId);
        }

        this.resetTtl(sub);
    }

    sync(clientId: string, subscriptionId: string, lastSequenceNumber?: number): I3xSyncItem[] {
        const sub = this.getAndVerify(clientId, subscriptionId);

        if (lastSequenceNumber !== undefined) {
            sub.queue = sub.queue.filter(item => item.sequenceNumber > lastSequenceNumber);
        }

        this.resetTtl(sub);
        return [...sub.queue];
    }

    stream(clientId: string, subscriptionId: string, res: any): void {
        const sub = this.getAndVerify(clientId, subscriptionId);

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

    private getAndVerify(clientId: string, subscriptionId: string): Subscription {
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub) {
            throw new Error(`Subscription ${subscriptionId} not found`);
        }
        if (sub.clientId !== clientId) {
            throw new Error(`Subscription ${subscriptionId} does not belong to client ${clientId}`);
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
