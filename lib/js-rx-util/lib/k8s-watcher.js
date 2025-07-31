/*
 * ACS Rx utilities.
 * Watch K8s endpoints.
 * Copyright 2023 AMRC
 */

import * as util    from "util";

import * as imm     from "immutable";
import * as rx      from "rxjs";

import { forever }  from "./util.js";

export class K8sError extends Error { }

/** Class for watching Kubernetes resources.
 * An object of this class accesses the K8s API and constructs Rx
 * sequences watching particular resource types.
 */
export class K8sWatcher {
    constructor (opts) {
        this.k8s        = opts.k8s;
        this.kc         = opts.kubeconfig;
        this.restart    = opts.restart ?? 5000;
        this.debounce   = opts.debounce ?? 100;
        this.errors     = opts.errors ?? (e => {});

        this.watcher    = new this.k8s.Watch(this.kc);
        this.objs       = this.k8s.KubernetesObjectApi.makeApiClient(this.kc);
    }

    /** Construct a URL path for a K8s resource type.
     * Options are passed as an object.
     * @arg apiVersion The resouce API version string
     * @arg kind The resource kind (e.g. `ConfigMap`).
     * @arg namespace The k8s namespace, or null.
     */
    async path_for (opts) {
        /* XXX This is an undocumented ('protected') API. It fetches and
         * caches resource types. We could replace if needed. */
        const res = await this.objs.resource(opts.apiVersion, opts.kind);

        const have_ns = opts.namespace != null;
        if (have_ns && !res.namespaced)
            throw new K8sError("Namespace supplied for non-namespaced resource");

        const apis = opts.apiVersion.includes("/") ? "apis" : "api";

        if (have_ns) {
            const ens = encodeURIComponent(opts.namespace);
            return util.format("/%s/%s/namespaces/%s/%s",
                apis, opts.apiVersion, ens, res.name);
        }
        return util.format("/%s/%s/%s", apis, opts.apiVersion, res.name);
    }

    /** Start a k8s WATCH and return a sequence of the results.
     * @arg path A k8s resource URL path
     * @arg query Query string
     */
    watch (path, query) {
        return new rx.Observable(obs => {
            /* watch returns a promise to a request, but this function
             * is not async. We don't need to await here; the callbacks
             * will get called when they are called. But when
             * unsubscription is requested we need to chain an abort
             * request onto the promise; usually (but not always) this
             * will execute immediately. */
            const reqp = this.watcher.watch(path, query,
                (type, obj) => obs.next([type, obj]), 
                err => err == null ? obs.complete() : obs.error(err));

            return () => reqp.then(req => req.abort());
        });
    }

    /** List and watch a K8s resource type.
    /* This returns a sequence of pairs. The first item in the pair is a
     * string, `CLEAR`, `ADDED` or `DELETED`. The sequence will emit
     *
     *      CLEAR
     *      ADDED for all items in an initial fetch
     *      actions returned from a k8s watch
     *
     * We do not make any k8s requests until the sequence is subscribed
     * to, and each subscription makes its own requests.
     *
     * Arguments are passed as an object.
     * @arg apiVersion K8s API version string
     * @arg kind Resource kind
     * @arg namespace Namespace, or null
     */
    list_and_watch (opts) {
        /* Make the initial requests for each subscriber */
        return rx.defer(async () => {
            /* Get an initial list. */
            const list = await this.objs.list(
                opts.apiVersion, opts.kind, opts.namespace);

            /* Get the path to watch */
            const path = await this.path_for(opts);

            /* This is back-compat for client-node 0.19 */
            return [list.body ?? list, path];
        }).pipe(
            /* When the Promise resolves, produce a sequence by joining... */
            rx.mergeMap(([initial, path]) => rx.concat(
                /* An initial marker */
                rx.of(["CLEAR"]),
                /* The items from the initial fetch */
                rx.from(initial.items.map(i => ["ADDED", i])),
                /* A watch sequence which will start straight after the
                 * initial fetch. */
                this.watch(path,
                    { resourceVersion: initial.metadata.resourceVersion }),
            ))
        );
    }

    /** Track all resources of a given kind. 
     * Returns a sequence of Immutable.Map representing the current
     * state of the objects of a particular kind. Key and value of the
     * map can be remapped, but default to the object UUID and the whole
     * object. Distinct updates will be suppressed, but the default
     * equality function (Immutable.is) will treat all plain JS objects
     * as distinct. 
     *
     * @args opts Passed into `list_and_watch`.
     */
    track_objects (opts) {
        opts = {
            key:        obj => obj.metadata.uid,
            value:      obj => obj,
            equal:      imm.is,
            ...opts,
        };

        /* Defer makes sure we do a new initial fetch every time we
         * retry the sequence */
        return this.list_and_watch(opts).pipe(
            forever(this.restart, this.errors),
            /* Pull out the key and value. CLEAR doesn't get mapped. */
            rx.map(([act, obj]) => 
                act == "CLEAR" ? [act]
                : [act, opts.key(obj), opts.value(obj)]),
            /* Accumulate the current state */
            rx.scan(
                (nodes, [act, key, value]) => 
                    act == "CLEAR" ? new imm.Map()
                    : act == "DELETED" ? nodes.delete(key)
                    : nodes.set(key, value),
                new imm.Map()),
            /* The mapping may remove changes */
            rx.distinctUntilChanged(opts.equal),
            /* Let the state settle */
            rx.debounceTime(this.debounce),
        );
    }
}

/** Construct a sequence watching a resource type.
 * This constructs a K8sWatcher and calls track_objects.
 */
export function k8sWatch (opts) {
    return new K8sWatcher(opts).track_objects(opts);
}
export { k8sWatch as k8s_watch };
