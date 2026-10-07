/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Time slicing for long work on a request path. node:sqlite is
 * synchronous, so a loop over a large part of the tree would hold the
 * event loop (and with it every other request, MQTT and the UNS) until
 * it finished. Such loops do their work in small steps and call
 * `await slicer.maybe()` between them; once SLICE_MS has passed since
 * the last pause it yields to the event loop with setImmediate.
 */

/** Longest run of synchronous work between pauses, in ms. */
export const SLICE_MS = 20;

export class Slicer {
    private last = performance.now();

    constructor(private budget: number = SLICE_MS) {}

    /** True when the budget for this slice is spent. */
    due(): boolean {
        return performance.now() - this.last >= this.budget;
    }

    /** Yield to the event loop now. */
    async pause(): Promise<void> {
        await new Promise<void>(r => setImmediate(r));
        this.last = performance.now();
    }

    /** Yield to the event loop if the budget is spent. */
    async maybe(): Promise<void> {
        if (this.due()) await this.pause();
    }
}
