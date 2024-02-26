/*
 * ACS Rx Utilities
 * Watch a seq-of-Set and run a seq for each value.
 * Copyright 2024 AMRC
 */

import imm  from "immutable";
import rx   from "rxjs";

function starts_stops (sets) {
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

/* This is a seq operator function. It expects a source sequence
 * of immutable Sets. Each Set is compared to the previous. When a new
 * entry appears, a sequence will be generated from the sequence factory
 * and emitted. When an entry disappears, the corresponding sequence
 * will end. */
export function mapItemsToObservable (factory) {
    return sets => {
        const [starts, stops] = starts_stops(sets);

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
    };
}

