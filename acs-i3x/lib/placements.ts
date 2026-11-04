/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Isa95Placements: each device's ISA-95 position, from the ISA-95
 * Placement app and the vocabulary.
 *
 * A placement names one vocabulary node; the position is the names
 * from that node's Enterprise down to it. The placement watcher
 * renders the same placement into the device's Edge Agent config, so
 * the device births it and the UNS ingester publishes it there. i3X
 * places a device in the tree from the placement, never from the
 * device's origin map.
 *
 * A rename or a move in the vocabulary changes the position of every
 * device placed at or under the node; those devices are reported as
 * changed, as a changed placement is.
 */

import * as rx from "rxjs";

import { ISA95_PLACEMENT_APP_UUID } from "./constants.js";
import type { Isa95Vocabulary } from "./isa95.js";

/** What the sync engine needs to place devices. */
export interface PlacementSource {
    /** Have both the placements and the vocabulary been read? */
    isReady(): boolean;
    /** A device's position, Enterprise first, or null when it is not
     * on the UNS (no placement, or one that does not render). */
    segments(device: string): string[] | null;
    /** Emits the devices whose position changed. Emits once (possibly
     * an empty list) when the source becomes ready. */
    changes: rx.Observable<string[]>;
}

interface Isa95PlacementsOpts {
    vocabulary: Isa95Vocabulary;
    log?: (msg: string, ...args: any[]) => void;
}

export class Isa95Placements implements PlacementSource {
    private vocabulary: Isa95Vocabulary;
    private log: (msg: string, ...args: any[]) => void;
    private placements: Map<string, any> | null = null;
    /* Each device's position as last reported, as JSON. */
    private current = new Map<string, string>();
    private wasReady = false;
    private subject = new rx.Subject<string[]>();
    private subscription: rx.Subscription | null = null;
    private offVocabulary: (() => void) | null = null;

    readonly changes: rx.Observable<string[]> = this.subject.asObservable();

    constructor(opts: Isa95PlacementsOpts) {
        this.vocabulary = opts.vocabulary;
        this.log = opts.log ?? (() => {});
        this.offVocabulary = this.vocabulary.onChange(() => this.recompute());
    }

    isReady(): boolean {
        return this.placements !== null && this.vocabulary.isReady();
    }

    segments(device: string): string[] | null {
        if (!this.isReady()) return null;
        return this.vocabulary.placementSegments(this.placements!.get(device));
    }

    /** Replace every placement: a Map from device UUID to config. */
    set(placements: Map<string, any>): void {
        this.placements = placements;
        this.recompute();
    }

    /** Follow the ISA-95 Placement app in ConfigDB. */
    run(fplus: any): this {
        this.subscription = (fplus.ConfigDB.search_app(ISA95_PLACEMENT_APP_UUID) as
            rx.Observable<{ entries(): Iterable<[string, any]> }>)
            .pipe(rx.retry({
                delay: (err: unknown) => {
                    console.error("Isa95Placements: following ConfigDB failed, retrying:", err);
                    return rx.timer(10_000);
                },
            }))
            .subscribe(m => this.set(new Map(m.entries())));
        return this;
    }

    stop(): void {
        this.subscription?.unsubscribe();
        this.subscription = null;
        this.offVocabulary?.();
        this.offVocabulary = null;
    }

    private recompute(): void {
        if (!this.isReady()) return;
        const next = new Map<string, string>();
        for (const device of this.placements!.keys()) {
            const s = this.segments(device);
            if (s) next.set(device, JSON.stringify(s));
        }
        const changed: string[] = [];
        for (const [device, s] of next)
            if (this.current.get(device) !== s) changed.push(device);
        for (const device of this.current.keys())
            if (!next.has(device)) changed.push(device);
        this.current = next;

        const first = !this.wasReady;
        this.wasReady = true;
        if (first)
            this.log("placements: %d devices placed", next.size);
        if (first || changed.length)
            this.subject.next(changed);
    }
}
