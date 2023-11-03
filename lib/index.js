/*
 * RxJS utilities.
 * Copyright 2023 AMRC
 */

import imm from "immutable";
import rx from "rxjs";

/**
 * Watch a K8s API endpoint. Project each object onto a [key, value]
 * pair and return a sequence of immutable Maps accumulating the current
 * state of the cluster. The sequence is deduplicated and debounced.
 *
 * @param opts.watch - A Watch object from @kubernetes/client-node.
 * @param opts.path - The K8s URL path to watch.
 * @param opts.map - A function to project the k8s objects. Should
 * return a pair [key, value] for an entry in the output Map. Defaults
 * to using the object UUID and the full object.
 * @param opts.equal - A function to compare two immutable Maps for
 * equality. Defaults to Immutable.is.
 * @param opts.errors - A function to log errors.
 * @param opts.restart - The delay before restarting. This can also be a
 *  Rx sequence to perform arbitrary handling.
 * @param opts.debounce - The debounce time interval.
 */
export function k8s_watch (opts) {
    opts = {
        restart:    5000,
        debounce:   100,
        errors:     e => {},
        key:        obj => obj.metadata.uid,
        value:      obj => obj,
        equal:      imm.is,
        ...opts,
    };
    return new rx.Observable(obs => {
        /* watch returns a promise to a request, but this function
         * is not async. We don't need to await here; the callbacks
         * will get called when they are called. But when
         * unsubscription is requested we need to chain an abort
         * request onto the promise; usually (but not always) this
         * will execute immediately. */
        const reqp = opts.watch.watch(opts.path, {},
            (type, obj) => obs.next([type, obj]), 
            err => err == null ? obs.complete() : obs.error(err));

        return () => reqp.then(req => req.abort());
    }).pipe(
        rx.tap({ error: opts.errors }),
        rx.retry({ delay: opts.restart }),
        rx.map(([act, obj]) => [act, opts.key(obj), opts.value(obj)]),
        rx.scan(
            (nodes, [act, key, value]) => act == "DELETED"
                ? nodes.delete(key)
                : nodes.set(key, value),
            new imm.Map()),
        rx.distinctUntilChanged(opts.equal),
        rx.debounceTime(opts.debounce),
    );
}
