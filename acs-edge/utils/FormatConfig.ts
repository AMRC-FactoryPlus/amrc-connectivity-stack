/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { schemaMetric, sparkplugDataType, sparkplugMetric, sparkplugTemplate } from "../lib/helpers/typeHandler.js";
export function reHashConf(conf: any) {
    const interner = new PropInterner();

    conf.deviceConnections?.forEach((devConn: any, i: number) => {
        devConn.devices?.forEach((dev: any, j: number) => {
            dev.pollInt = devConn.pollInt;
            dev.payloadFormat = devConn.payloadFormat;
            dev.delimiter = devConn.delimiter;
            conf.deviceConnections[i].devices[j].metrics = [];
            /* Device-level historian override: when the device is
             * marked not to record (the default for simulated
             * devices' operators to choose), every metric goes out
             * transient regardless of its own Record_To_Historian. */
            const suppressHistorian = dev.recordToHistorian === false;
            dev.tags?.forEach((tag: schemaMetric) => {
                conf.deviceConnections[i].devices[j].metrics.push(
                    buildTagObject(tag, suppressHistorian, interner));
            })
            delete conf.deviceConnections[i].devices[j].tags;
        })
    });
    return conf;
}

/* Most metrics have the same properties as thousands of others. This
 * returns one shared, identical properties object for each distinct set
 * of properties. Nothing mutates these objects (Device copies before it
 * changes a metric and the Sparkplug encoder only reads), so sharing is
 * safe. One interner lives for one reHashConf call. */
class PropInterner {
    // type -> value -> {value, type}. Map keys compare by value for
    // primitives and by identity for objects.
    private props = new Map<string, Map<any, any>>();
    private ids = new Map<object, number>();
    private sets = new Map<string, any>();
    private types = new Map<string, string>();

    prop(value: any, type: string) {
        // Map treats -0 and 0 as the same key. They encode differently
        // as a Float, so a -0 gets its own unshared object.
        if (Object.is(value, -0))
            return this.make(value, type);
        let byValue = this.props.get(type);
        if (!byValue) this.props.set(type, byValue = new Map());
        let prop = byValue.get(value);
        if (!prop) byValue.set(value, prop = this.make(value, type));
        return prop;
    }

    private make(value: any, type: string) {
        const prop = { value, type };
        this.ids.set(prop, this.ids.size);
        return prop;
    }

    set(properties: any) {
        let key = "";
        for (const name in properties)
            key += `${this.ids.get(properties[name])},`;
        let shared = this.sets.get(key);
        if (!shared) this.sets.set(key, shared = properties);
        return shared;
    }

    /* Remove the endianness from a tag type */
    baseType(type: string) {
        let base = this.types.get(type);
        if (base === undefined)
            this.types.set(type, base = type.replace(/[BL]E/g, ""));
        return base;
    }
}

function buildTagObject(tag: schemaMetric|any, suppressHistorian = false, interner = new PropInterner()): sparkplugMetric {

    // Store the endianness of the tag, if it has one
    const endianness = (tag.type.endsWith("BE") ? 4321 : tag.type.endsWith("LE") ? 1234 : null);

    // Remove the endianness from the tag type
    tag.type = interner.baseType(tag.type);

    return {
        name: tag.Name,
        value: tag.value,
        type: tag.type,
        isTransient: suppressHistorian || !tag.recordToDB,
        properties: interner.set({
            method: interner.prop(tag.method, sparkplugDataType.string),
            address: interner.prop(tag.address, sparkplugDataType.string),
            path: interner.prop(tag.path, sparkplugDataType.string),
            engUnit: interner.prop(tag.engUnit, sparkplugDataType.string),
            engLow: interner.prop(tag.engLow, sparkplugDataType.float),
            engHigh: interner.prop(tag.engHigh, sparkplugDataType.float),
            deadband: interner.prop(tag.deadBand, sparkplugDataType.string),
            tooltip: interner.prop(tag.tooltip, sparkplugDataType.string),
            documentation: interner.prop(tag.docs, sparkplugDataType.string),
            endianness: interner.prop(endianness, sparkplugDataType.uInt16),
        }),
    };
}
