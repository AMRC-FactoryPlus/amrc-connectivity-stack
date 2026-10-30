/*
 * ACS Briefcase exporter
 * Describe a device for the people who read its data
 * Copyright 2026 University of Sheffield
 */

import { defined } from "./util.js";

const META_KEYS = new Set(["Schema_UUID", "Instance_UUID"]);

/** Describe a device from its Device Information config.
 *
 * Only what helps to read the data is kept: the objects in the device,
 * with their schemas, and each metric recorded to the historian, with
 * its type, unit and documentation. Connection details, such as the
 * protocol address of each metric, are left out.
 *
 * The origin map is walked as Data Access walks it: keys joined with
 * `/` give the Sparkplug metric name, and an object with a
 * `Sparkplug_Type` is a metric.
 *
 * @param opts.uuid The device UUID.
 * @param opts.name The device's name, from General Information.
 * @param opts.info The device's Device Information config.
 */
export function describe_device ({ uuid, name, info }) {
    const root = info?.originMap ?? {};
    const objects = [];
    const metrics = [];

    const walk = (node, at) => {
        for (const [key, value] of Object.entries(node)) {
            if (META_KEYS.has(key)) continue;
            if (!value || typeof value != "object" || Array.isArray(value))
                continue;

            const full = at ? `${at}/${key}` : key;

            if (value.Sparkplug_Type) {
                if (value.Record_To_Historian)
                    metrics.push(defined({
                        name:           full,
                        type:           value.Sparkplug_Type,
                        unit:           value.Eng_Unit,
                        documentation:  value.Documentation,
                    }));
                continue;
            }

            if (value.Schema_UUID || value.Instance_UUID)
                objects.push(defined({
                    path:       full,
                    schema:     value.Schema_UUID,
                    instance:   value.Instance_UUID,
                }));
            walk(value, full);
        }
    };
    walk(root, "");

    return defined({
        uuid, name,
        schema:     root.Schema_UUID,
        objects, metrics,
    });
}
