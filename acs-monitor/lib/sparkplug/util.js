/*
 * ACS Monitor
 * Sparkplug utilities
 * Copyright 2024 AMRC
 */

import * as uuid        from "uuid";

import { UUIDs }        from "@amrc-factoryplus/service-client";

import { Special }      from "../uuids.js";

export function fp_v5_uuid (...args) {
    return uuid.v5(args.join(":"), UUIDs.Special.FactoryPlus);
}

export function mk_instance (device, schema, prefix) {
    const instance = fp_v5_uuid(Special.V5Metric, device, prefix);
    return [
        { name: `${prefix}/Schema_UUID`, type: "UUID", value: schema },
        { name: `${prefix}/Instance_UUID`, type: "UUID", value: instance },
    ];
}

