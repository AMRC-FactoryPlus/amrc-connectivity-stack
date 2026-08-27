/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { schemaMetric, sparkplugDataType, sparkplugMetric, sparkplugTemplate } from "../lib/helpers/typeHandler.js";
export function reHashConf(conf: any) {

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
                    buildTagObject(tag, suppressHistorian));
            })
            delete conf.deviceConnections[i].devices[j].tags;
        })
    });
    return conf;
}

function buildTagObject(tag: schemaMetric|any, suppressHistorian = false): sparkplugMetric {

    // Store the endianness of the tag, if it has one
    const endianness = (tag.type.endsWith("BE") ? 4321 : tag.type.endsWith("LE") ? 1234 : null);

    // Remove the endianness from the tag type
    tag.type = tag.type.replace(/[BL]E/g, "");

    return {
        name: tag.Name,
        value: tag.value,
        type: tag.type,
        isTransient: suppressHistorian || !tag.recordToDB,
        properties: {
            method: { value: tag.method, type: sparkplugDataType.string },
            address: { value: tag.address, type: sparkplugDataType.string },
            path: { value: tag.path, type: sparkplugDataType.string },
            engUnit: { value: tag.engUnit, type: sparkplugDataType.string },
            engLow: { value: tag.engLow, type: sparkplugDataType.float },
            engHigh: { value: tag.engHigh, type: sparkplugDataType.float },
            deadband: { value: tag.deadBand, type: sparkplugDataType.string },
            tooltip: { value: tag.tooltip, type: sparkplugDataType.string },
            documentation: { value: tag.docs, type: sparkplugDataType.string },
            endianness: {
                value: endianness,
                type: sparkplugDataType.uInt16
            }
        }
    };
}
