/*
 * ACS service setup
 * An edge Helm chart repo for the split driver tests
 * Copyright 2026 University of Sheffield AMRC
 */

import { EdgeCharts } from "../lib/edge-charts.js";

/** The Edge Agent chart's values file, as edge-helm-charts stamps it. */
export function chart_values (tag, registry = "ghcr.io/amrc-factoryplus") {
    return [
        "image:",
        "  default:",
        `    registry: "${registry}"`,
        `    tag: "${tag}"`,
        `    pullPolicy: "IfNotPresent"`,
        "  edgeAgent:",
        "    repository: acs-edge",
        "",
    ].join("\n");
}

/** A chart repo whose branches hold the given values files. Change
 * `branches` to change the repo between runs. A branch set to an Error
 * makes reading throw it. */
export class FakeCharts extends EdgeCharts {
    constructor (branches) {
        super({
            path: "shared/helm",
            read: async b => {
                const v = this.branches[b];
                if (v instanceof Error) throw v;
                return v;
            },
        });
        this.branches = branches;
    }
}

/** The repo after an upgrade where nobody had changed main. */
export const ready_charts = () => new FakeCharts({
    main:   chart_values("v9.0.0"),
    acs:    chart_values("v9.0.0"),
});
