/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { schemaMetric, sparkplugDataType, sparkplugMetric, sparkplugTemplate } from "../lib/helpers/typeHandler.js";
import * as secrets from "../lib/k8sSecrets.js";
// Temporary stop gap function to convert from old GUI conf format to actual Sparkplug format defined in typescript
export function reHashConf(conf: any) {
    conf.deviceConnections?.forEach((devConn: any, i: number) => {
        devConn.devices?.forEach((dev: any, j: number) => {
            dev.pollInt = devConn.pollInt;
            dev.payloadFormat = devConn.payloadFormat;
            dev.delimiter = devConn.delimiter;
            dev.templates?.forEach((template: any, k: number) => {
                // conf.deviceConnections[i].devices[j].templates[k].isDefinition = true;
                conf.deviceConnections[i].devices[j].templates[k].value = { metrics: [] };
                template.metrics?.forEach((metric: schemaMetric) => {
                    conf.deviceConnections[i].devices[j].templates[k].value.metrics.push({
                        name: metric.Name,
                        value: metric.value,
                        type: lowerCaseType(metric.type.replace(/[BL]E/g, "")),
                        isTransient: !metric.recordToDB,
                        properties: {
                            method: { value: metric.method || null, type: sparkplugDataType.string },
                            address: { value: metric.address || null, type: sparkplugDataType.string },
                            path: { value: metric.path || null, type: sparkplugDataType.string },
                            engUnit: { value: metric.engUnit || null, type: sparkplugDataType.string },
                            engLow: { value: metric.engLow || null, type: sparkplugDataType.float },
                            engHigh: { value: metric.engHigh || null, type: sparkplugDataType.float },
                            deadband: { value: metric.deadBand || null, type: sparkplugDataType.string },
                            tooltip: { value: metric.tooltip || null, type: sparkplugDataType.string },
                            documentation: { value: metric.docs || null, type: sparkplugDataType.string },
                            endianness: {
                                value: (metric.type.endsWith("BE") ? 4321 : metric.type.endsWith("LE") ? 1234 : null),
                                type: sparkplugDataType.uInt16
                            }
                        }
                    });
                })
                delete conf.deviceConnections[i].devices[j].templates[k].metrics;
            })
            conf.deviceConnections[i].devices[j].metrics = [];
            dev.tags?.forEach((tag: schemaMetric) => {
                const metric: sparkplugMetric = rehashTag(tag);
                // if (tag.type == "template") {
                //     (metric.value as sparkplugTemplate).isDefinition = false;
                //     (metric.value as sparkplugTemplate).templateRef = tag.templateRef;
                //     (metric.value as sparkplugTemplate).metrics = (metric.value as sparkplugTemplate).metrics.map((metric) => {
                //         return rehashTag(metric);
                //     })
                // }
                conf.deviceConnections[i].devices[j].metrics.push(metric);
            })
            delete conf.deviceConnections[i].devices[j].tags;
        })
    });
    return conf;
}

export function rehashTag(tag: schemaMetric|any): sparkplugMetric {
    //add some formatting if the tag is string
    tag.type = tag.type.replace(/[BL]E/g, "");
    if(tag.type == sparkplugDataType){
        lowerCaseType(tag.type);
    }
    return {
        name: tag.Name,
        value: tag.value,
        type: tag.type,
        isTransient: !tag.recordToDB,
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
                value: (tag.type.endsWith("BE") ? 4321 : tag.type.endsWith("LE") ? 1234 : null),
                type: sparkplugDataType.uInt16
            }
        }
    };
}

/**
 * Changes the first letter of a string to lower case
 * @param typeString type to alter case
 * @returns type with the first letter lower case 
 */
var lowerCaseType = (typeString: string) : string => {
    return typeString.charAt(0).toUpperCase() + typeString.slice(1);
};
