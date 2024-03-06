/*
 * ACS Rx Utilities
 * Watch a seq-of-Set and run a seq for each value.
 * Copyright 2024 AMRC
 */

import imm  from "immutable";
import rx   from "rxjs";

/* Accepts a sequence of Immutable.Sets. Tracks the items in these sets,
 * and picks up when items appear and when items disappear. Returns two
 * seqs, one for new items and one for removed items. */
export function startStops (sets) {
    /* Work out what's changed */
    const changes = sets.pipe(
        rx.startWith(imm.Set()),
        rx.pairwise(),
        rx.mergeMap(([then, now]) => imm.Seq([
            then.subtract(now).map(u => [false, u]),
            now.subtract(then).map(u => [true, u]),
        ]).flatten()),
        rx.share(),
    );
    /* Split the changes into starts and stops */
    return rx.partition(changes, ch => ch[0])
        .map(seq => seq.pipe(rx.map(ch => ch[1])));
}

/* This is a creation function, not an operator. Accepts a seq of
 * 'starts', a seq of 'stops' and a factory function. Returns a seq of
 * seqs. Each time 'starts' emits an item, pass the item to the factory
 * and emit the returned sequence. Arrange for the sequence to end when
 * an equal (Immutable.is) value appears on 'stops'. */
export function fromStartStops (starts, stops, factory) {
    /* When we get a start, return a new seq for that item */
    return starts.pipe(
        rx.map(item => {
            /* Watch for a stop signal for this item */
            const stopper = stops.pipe(
                rx.filter(stop => imm.is(stop, item)),
            );

            /* Generate a sequence that runs until we get a stop */
            return factory(item).pipe(
                rx.takeUntil(stopper),
            );
        }),
    );
}

/* Compose startStops with fromStartStops. This is an operator accepting
 * a sequence of Immutable.Sets. When a new item appears, pass the item
 * to the factory function and emit the resulting sequence. Arrange for
 * the subseq to stop when the item disappears from the Sets. */
export function mapStartStops (factory) {
    return sets => {
        const [starts, stops] = startStops(sets);
        return fromStartStops(starts, stops, factory);
    };
}

