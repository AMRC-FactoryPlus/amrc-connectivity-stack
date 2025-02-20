/*
 * Factory+ JS client library
 * Metric-handling utilities
 * Copyright 2025 University of Sheffield AMRC
 */

/* XXX These are random compat functions from the old `utilities`
 * library. In general the problems they solve should be better solved
 * some other way.
 */

export class MetricBranch {
}

export class MetricTree {
    constructor (payload) {
        for (const m of payload.metrics) {
            const path = m.name.split("/");
            const name = path.pop();

            let obj = this;
            for (const p of path) {
                obj = obj[p] ||= new MetricBranch();

                if (!(obj instanceof MetricBranch)) {
                    const branch = new MetricBranch();
                    branch.$metric = obj;
                    obj = branch;
                }
            }
            obj[name] = m;
        }
    }
}

/* These functions are a compatibility interface for existing code; I
 * think acs-directory, acs-configdb and acs-cmdesc. Do not use in new
 * code. */

const make_builder = (new_metrics) => {
    return (metrics) => {
        metrics = metrics ?? [];
        metrics.push(...new_metrics);
        return metrics;
    };
};

export const MetricBuilder = {
    birth: {
        /* Standard metrics every Node needs */
        node: make_builder([
            /* XXX always send bdSeq as 0 for now */
            { name: "bdSeq", type: "UInt64", value: 0 },
            { name: "Node Control/Rebirth", type: "Boolean", value: false },
        ]),
    },

    death: {
        /* Node death certificate */
        node: make_builder([
            /* XXX always send bdSeq as 0 for now */
            { name: "bdSeq", type: "UInt64", value: 0 },
        ]),
    },
};
