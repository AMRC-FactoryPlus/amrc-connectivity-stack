/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * A counting semaphore for async work. History uses one, shared by
 * every request, to cap the Flux queries in flight across the whole
 * process: a per-request limit does not stop many requests at once
 * from queueing thousands of queries on InfluxDB.
 */

export class Semaphore {
    private active = 0;
    private waiters: Array<() => void> = [];
    private head = 0;

    constructor(readonly limit: number) {
        if (!(limit >= 1)) throw new RangeError(`Semaphore limit must be at least 1, not ${limit}`);
    }

    /** Calls running now. */
    get running(): number { return this.active; }

    /** Calls waiting for a slot. */
    get waiting(): number { return this.waiters.length - this.head; }

    /** Run `fn` when a slot is free; the slot is held until it settles. */
    async run<T>(fn: () => Promise<T>): Promise<T> {
        if (this.active >= this.limit) {
            await new Promise<void>(r => this.waiters.push(r));
        } else {
            this.active++;
        }
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    /* Hand the slot straight to the next waiter, if any, so a new
     * caller cannot jump the queue. */
    private release(): void {
        if (this.head < this.waiters.length) {
            const next = this.waiters[this.head];
            this.waiters[this.head++] = undefined as any;
            if (this.head > 1024 && this.head * 2 > this.waiters.length) {
                this.waiters = this.waiters.slice(this.head);
                this.head = 0;
            }
            next();
        } else {
            this.active--;
        }
    }
}
