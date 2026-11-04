/*
 * AMRC ACS UNS Ingester (Sparkplug)
 * The ISA-95 hierarchy of a device, from its birth certificate
 * Copyright 2026 University of Sheffield AMRC
 */

import {isa95_segments_from_metrics} from "@amrc-factoryplus/service-client";

export interface Isa95 {
    enterprise: string | null,
    site: string | null,
    area: string | null,
    workCenter: string | null,
    workUnit: string | null,
}

/**
 * The device's ISA-95 hierarchy, by the shared UNS rule: a Hierarchy-v1
 * object at exactly Device_Information/ISA95_Hierarchy, with trimmed
 * levels read down to the first empty one. A hierarchy anywhere else,
 * or with a level that cannot go in a topic, does not count.
 * Every level is a non-empty string or null, and no level is set below
 * a null one. A null enterprise means the device is not on the UNS.
 */
export function birthIsa95(metrics: Array<{ name: string, value: any }>): Isa95 {
    const s: string[] = isa95_segments_from_metrics(metrics) ?? [];
    return {
        enterprise: s[0] ?? null,
        site: s[1] ?? null,
        area: s[2] ?? null,
        workCenter: s[3] ?? null,
        workUnit: s[4] ?? null,
    };
}

/**
 * The UNS topic for one metric of a device, or null when the device
 * has no Enterprise.
 * `path` is the metric's folder within the device (may be empty).
 */
export function buildUnsTopic(isa95: Isa95, device: string, path: string, metricName: string): string | null {
    const segments = isa95Segments(isa95);
    if (!segments.length) return null;
    return `UNS/v1/${segments.join("/")}/Edge/${device}/${path ? (path + '/') : ''}${metricName}`;
}

/** The UNS topic segments for a hierarchy, Enterprise first. */
export function isa95Segments(isa95: Isa95): string[] {
    const out: string[] = [];
    for (const v of [isa95.enterprise, isa95.site, isa95.area, isa95.workCenter, isa95.workUnit]) {
        if (v == null) break;
        out.push(v);
    }
    return out;
}
