/*
 * ACS Data Access Service
 * Device origin map traversal for sub-device metric references
 * Copyright 2026 University of Sheffield
 */

import { valid_uuid } from "./validate.js";

const META_KEYS = new Set(["Schema_UUID", "Instance_UUID"]);

/** Walks a device's origin map (the `originMap` of its DeviceInformation
 * config) the same way the edge agent does when it names metrics: keys
 * joined with `/`, with any object carrying `Sparkplug_Type` a metric.
 *
 * @param origin_map The origin map, or null if the device has none.
 * @param device The device UUID. This is also its top-level Instance_UUID,
 * so it maps to the root path.
 * @returns {{instances: Map<string, string>, metrics: Array}}
 *  instances maps each Instance_UUID to its object's path ("" for the
 *  root). metrics lists every metric recorded to the historian as
 *  { instance, metric, path, type, unit, documentation }, where
 *  `instance` is the nearest enclosing object with an Instance_UUID and
 *  `metric` is the path from that object to the metric.
 */
export function walk_origin_map (origin_map, device) {
    const instances = new Map([[device, ""]]);
    const metrics = [];

    if (valid_uuid(origin_map?.Instance_UUID))
        instances.set(origin_map.Instance_UUID, "");

    const walk = (node, path, instance, instance_path) => {
        for (const [key, value] of Object.entries(node)) {
            if (META_KEYS.has(key)) continue;
            if (!value || typeof value != "object" || Array.isArray(value))
                continue;

            const full = path ? `${path}/${key}` : key;

            if (value.Sparkplug_Type) {
                if (value.Record_To_Historian)
                    metrics.push({
                        instance,
                        metric:         full.slice(instance_path ? instance_path.length + 1 : 0),
                        path:           full,
                        type:           value.Sparkplug_Type,
                        unit:           value.Eng_Unit,
                        documentation:  value.Documentation,
                    });
                continue;
            }

            if (valid_uuid(value.Instance_UUID)) {
                instances.set(value.Instance_UUID, full);
                walk(value, full, value.Instance_UUID, full);
            }
            else {
                walk(value, full, instance, instance_path);
            }
        }
    };

    if (origin_map && typeof origin_map == "object")
        walk(origin_map, "", device, "");

    return { instances, metrics };
}

/** Resolves a stored metric reference to the tags the historian writes.
 *
 * The historian stores everything before the last `/` of the metric name
 * in the `path` tag, and the last segment (plus a type suffix) as the
 * measurement. Metrics at the device root have no `path` tag at all.
 *
 * @param instances The `instances` map from walk_origin_map.
 * @param ref A stored reference, { instance, metric }.
 * @returns {{path: string|null, name: string}|null} null when the
 *  instance is no longer in the origin map.
 */
export function resolve_metric (instances, ref) {
    const base = instances.get(ref.instance);
    if (base == null) return null;

    const full = base ? `${base}/${ref.metric}` : ref.metric;
    const i = full.lastIndexOf("/");

    return i < 0
        ? { path: null, name: full }
        : { path: full.slice(0, i), name: full.slice(i + 1) };
}
