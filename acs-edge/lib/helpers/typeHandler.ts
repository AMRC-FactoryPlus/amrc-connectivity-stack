/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { JSONPath } from "jsonpath-plus";
import * as xpath from "xpath";
import { DOMParser } from "@xmldom/xmldom";
import * as jsonpointer from 'jsonpointer';
import * as Long from "long";
import { MessageSecurityMode, SecurityPolicy } from "node-opcua";
import { Address } from "@amrc-factoryplus/utilities";
import { log } from "./log.js";

export enum serialisationType {
    ignored = "Defined by Protocol",
    delimited = "Delimited String",
    JSON = "JSON",
    JSONBatched = "JSON (Batched)",
    XML = "XML",
    fixedBuffer = "Buffer",
    serialisedBuffer = "Buffer"
}

export enum sparkplugDataType {
    boolean = "Boolean",
    int8 = "Int8",
    int16 = "Int16",
    int32 = "Int32",
    int64 = "Int64",
    uInt8 = "UInt8",
    uInt16 = "UInt16",
    uInt32 = "UInt32",
    uInt64 = "UInt64",
    float = "Float",
    double = "Double",
    dateTime = "DateTime",
    string = "String",
    text = "Text",
    uuid = "UUID",
    dataSet = "DataSet",
    bytes = "Bytes",
    file = "File",
    template = "Template",
    propertySet = "PropertySet",
    propertySetList = "PropertySetList",
}

export enum restAuthMethod {
    None = "None", Basic = "Basic"
}

export interface restConnDetails {
    baseURL: string,
    authMethod: restAuthMethod,
    username?: string,
    password?: string
}

export enum OPCUADataType {
    Boolean = "Boolean",
    Int8 = "SByte",
    Int16 = "Int16",
    Int32 = "Int32",
    Int64 = "Int64",
    UInt8 = "Byte",
    UInt16 = "UInt16",
    UInt32 = "UInt32",
    UInt64 = "UInt64",
    Float = "Float",
    Double = "Double",
    DateTime = "DateTime",
    String = "String",
    Text = "String",
    UUID = "Guid",
    DataSet = "dataSet",
    Bytes = "bytes",
    File = "file",
    Template = "template",
    PropertySet = "propertySet",
    PropertySetList = "propertySetList",
}

export enum byteOrder {
    littleEndian = 1234, bigEndian = 4321
}

export interface schemaMetric {
    type: sparkplugDataType,
    method: string,
    address: string,
    path: string,
    value: sparkplugDataType,
    engUnit: string,
    engLow: number,
    engHigh: number,
    deadBand: number,
    Name: string,
    tooltip: string,
    docs: string,
    recordToDB: boolean,
    templateRef?: string
}


export interface nodeControl {
    asyncPubMode: boolean,
    compressPayload: boolean,
    pubInterval: number,
}

export interface sparkplugConfig {
    address: Address,
    uuid: string,
    alerts?: {
        configFetchFailed: boolean, configInvalid: boolean,
    },
    configRevision?: string,
    nodeControl?: nodeControl,
}

export interface sparkplugPayload {
    timestamp: number,
    metrics: sparkplugMetric[],
    seq?: number,
    uuid?: string,
    body?: Buffer
}

export type sparkplugValue =
    number
    | string
    | boolean
    | Buffer
    | sparkplugDataSet
    | sparkplugTemplate
    | Long
    | bigint
    | null;

export interface sparkplugMetric {
    name?: string,
    value: sparkplugValue,
    type: sparkplugDataType,
    alias?: number | Long | BigInt,
    isHistorical?: boolean,
    isTransient?: boolean,
    isNull?: boolean,
    metadata?: sparkplugMetricMetadata,
    timestamp?: number,
    properties?: sparkplugMetricProperties,
}

export interface long {
    low: number,
    high: number,
    unsigned?: boolean
}

export interface sparkplugTemplate {
    version?: string,
    metrics: sparkplugMetric[],
    parameters?: sparkplugTemplateParameter[],
    isDefinition: boolean,
    templateRef?: string,
}

export interface sparkplugTemplateParameter {
    name: string,
    type: sparkplugDataType,
    value: number | string | boolean
}

export interface sparkplugMetricMetadata {
    isMultiPart: boolean,
    contentType: string,
    size: number,
    seq?: number,
    fileName?: string,
    fileType?: string,
    md5?: string,
    description: string
}

export interface sparkplugMetricProperties {
    method: sparkplugMetricProperty
    address: sparkplugMetricProperty
    path?: sparkplugMetricProperty,
    friendlyName?: sparkplugMetricProperty,
    engUnit?: sparkplugMetricProperty,
    engLow?: sparkplugMetricProperty,
    engHigh?: sparkplugMetricProperty,
    tooltip?: sparkplugMetricProperty,
    documentation?: sparkplugMetricProperty
    endianness?: sparkplugMetricProperty,
    deadband?: sparkplugMetricProperty,
    deadbandMode?: sparkplugMetricProperty,
}

export interface sparkplugMetricProperty {
    value: sparkplugValue,
    isNull?: boolean,
    type: sparkplugDataType
}

export interface sparkplugDataSet {
    numOfColumns: number,
    columns: string[],
    types: sparkplugDataType[],
    rows: sparkplugValue[][]
}

export interface metricPathGroup { // { Path : Index}
    [index: string]: number
}

export interface metricAddrPathGroup { // {Address : { Path : Index}}
    [index: string]: metricPathGroup
}

export interface metricIndex {
    [index: string]: number
}

export interface metricArrIndex {
    [index: string]: number[]
}

export interface nestedMetricIndex {
    [index: string]: metricIndex
}

export class Metrics {
    #array: sparkplugMetric[]
    #addrIndex: metricArrIndex
    #addrPathIndex: metricAddrPathGroup
    #nameIndex: metricIndex
    #aliasIndex: metricIndex

    constructor(metricArr: sparkplugMetric[]) {
        this.#array = metricArr;
        this.#nameIndex = {};
        this.#aliasIndex = {};
        this.#addrPathIndex = {};
        this.#addrIndex = {};
        this.#buildIndices();
    }

    #buildIndices() {
        for (let i = 0; i < this.#array.length; i++) {
            const metric = this.#array[i];
            this.#nameIndex[metric.name || ""] = i;
            // this.#aliasIndex[metric.alias as number] = i;
            const props = metric.properties;
            const addr = props?.address?.value as string | undefined;
            const path = (props?.path?.value ?? "") as string;
            const meth = (props?.method?.value ?? "") as string;
            if (addr != null && /GET/.test(meth)) {
                if (!this.#addrIndex[addr]) {
                    this.#addrIndex[addr] = [];
                }
                this.#addrIndex[addr].push(i);
                this.#addrIndex[addr].push(i);
                if (!this.#addrPathIndex[addr]) {
                    this.#addrPathIndex[addr] = {};
                }
                this.#addrPathIndex[addr][path] = i;
            }
        }
    }

    setAlias(index: number, alias: number) {
        this.#array[index].alias = alias;
        this.#aliasIndex[alias] = index;
    }

    get length() {
        return this.#array.length;
    }

    get array() {
        return this.#array
    }

    add(metrics: sparkplugMetric[]) {
        this.#array = this.#array.concat(metrics);
        this.#buildIndices();
    }

    get addresses() {
        return Object.keys(this.#addrPathIndex);
    }

    getByName(name: string) {
        return this.#array[this.#nameIndex[name]];
    }

    setValueByName(name: string, value: sparkplugValue, timestamp?: number) {
        this.#array[this.#nameIndex[name]].value = value;
        this.#array[this.#nameIndex[name]].timestamp = timestamp || Date.now();
        this.#array[this.#nameIndex[name]].isNull = (value === null);
        return this.#array[this.#nameIndex[name]]
    }

    setValueByIndex(index: number, value: sparkplugValue, timestamp?: number) {
        this.#array[index].value = value;
        this.#array[index].timestamp = timestamp || Date.now();
        this.#array[index].isNull = (value === null);
        return this.#array[index];
    }

    // removeByName(name: string) {
    //     const spliced = this.#array.splice(this.#nameIndex[name], 1);
    //     this.#buildIndices();
    //     return spliced;
    // }

    getByAlias(alias: number) {
        return this.#array[this.#aliasIndex[alias]];
    }

    setValueByAlias(alias: number, value: sparkplugValue, timestamp?: number) {
        this.#array[this.#aliasIndex[alias]].value = value;
        this.#array[this.#aliasIndex[alias]].timestamp = timestamp || Date.now();
        this.#array[this.#aliasIndex[alias]].isNull = (value === null)
        return this.#array[this.#aliasIndex[alias]];
    }

    // removeByAlias(alias: number) {
    //     return this.#array.splice(this.#aliasIndex[alias], 1);
    // }

    getByAddress(addr: string) {
        return this.#addrIndex[addr].map((x) => this.#array[x]);
    }

    getPathsForAddr(addr: string) {
        return Object.keys(this.#addrPathIndex[addr] || {});
    }

    getByAddrPath(addr: string, path: string) {
        return this.#array[this.#addrPathIndex[addr][path]];
    }

    setValueByAddrPath(addr: string, path: string, value: sparkplugValue, timestamp?: number) {
        this.#array[this.#addrPathIndex[addr][path]].value = value;
        this.#array[this.#addrPathIndex[addr][path]].timestamp = timestamp || Date.now();
        this.#array[this.#addrPathIndex[addr][path]].isNull = (value === null)
        return this.#array[this.#addrPathIndex[addr][path]];
    }

    // removeByAddrPath(addr: string, path: string) {
    //     const spliced = this.#array.splice(this.#addrPathIndex[addr][path], 1);
    //     this.#buildIndices();
    //     return spliced;
    // }
}



/**
 * Processes a JSON batched payload and returns an array of values and timestamps
 * This function expects an array of objects and uses the metric's path to extract values
 * @param payload The JSON array payload to process
 * @param metric The metric to use for processing (including path configuration)
 * @returns An array of objects with value and timestamp properties
 */
export function processJSONBatchedPayload(payload: any[], metric: sparkplugMetric): { value: any, timestamp?: number }[] {
    const results: { value: any, timestamp?: number }[] = [];
    const path = (typeof metric.properties !== "undefined" && typeof metric.properties.path !== "undefined" ? metric.properties.path.value as string : "");

    // Validate that payload is an array
    if (!Array.isArray(payload)) {
        log('JSON (Batched) payload must be an array');
        return results;
    }

    // Process each object in the array
    payload.forEach((item, index) => {
        // Validate that each item is an object
        if (typeof item !== 'object' || item === null) {
            log(`JSON (Batched) payload item ${index} must be an object`);
            return;
        }

        let value;

        // Extract value based on path or direct property
        if (path) {
            /* Work around a bug in the JSONPath library */
            let newVal = path === "$" && item === false
                ? [false]
                : JSONPath({
                    path: path,
                    json: item
                });

            if (item === 0 || !Array.isArray(newVal)) {
                value = 0;
            } else {
                if (newVal[0]?.type === "Buffer") {
                    newVal[0] = Buffer.from(newVal[0].data);
                }
                value = parseTypeFromString(metric.type, newVal[0]);
            }
        } else if (item.hasOwnProperty('value')) {
            // If no path is provided but the object has a 'value' property, use that
            value = parseTypeFromString(metric.type, item.value);
        } else {
            // If no path and no 'value' property, log error and skip
            log(`JSON (Batched) payload item ${index} has no path configured and no 'value' property`);
            return;
        }

        // Extract timestamp if available
        let timestamp: number | undefined;
        if (item.hasOwnProperty('timestamp')) {
            timestamp = item.timestamp;
            if (timestamp && !isTimestampInMilliseconds(timestamp)) {
                timestamp = timestamp * 1000;
            }
        } else if (item.hasOwnProperty('time')) {
            timestamp = item.time;
            if (timestamp && !isTimestampInMilliseconds(timestamp)) {
                timestamp = timestamp * 1000;
            }
        }

        results.push({ value, timestamp });
    });

    return results;
}



export function parseValueFromPayload(msg: any, metric: sparkplugMetric, payloadFormat: serialisationType | string, delimiter?: string) {
    let payload: any;
    const path = (typeof metric.properties !== "undefined" && typeof metric.properties.path !== "undefined" ? metric.properties.path.value as string : "");
    switch (payloadFormat) {
        case serialisationType.delimited:
            // Handle no delimiter
            payload = (delimiter != '') ? msg.toString()
                .split(delimiter) : msg.toString();

            // Handle no path parsing
            if (path == null || path == '') {
                return parseTypeFromString(metric.type, payload);
            } else {
                return parseTypeFromString(metric.type, payload[path]);
            }
        case serialisationType.JSON:
            try { // Handles error if invalid JSON is sent in
                if (typeof msg == "string") {
                    payload = JSON.parse(msg);
                } else if (Buffer.isBuffer(msg)) {
                    payload = JSON.parse(msg.toString());
                } else {
                    payload = msg;
                }
            } catch (e: any) {
                log('Failed to parse JSON data')
            }

            // Note: Array payloads are now handled in _handleData using processArrayPayload
            // This function only processes non-array payloads or is called for a single item

            if (path) {
                /* Work around a bug in the JSONPath library */
                let newVal = path === "$" && payload === false
                    ? [false]
                    : JSONPath({
                        path: path,
                        json: payload
                    });
                if (payload === 0 || !Array.isArray(newVal)) {
                    return 0;
                } else {
                    if (newVal[0]?.type === "Buffer") {
                        newVal[0] = Buffer.from(newVal[0].data);
                    }
                    return parseTypeFromString(metric.type, newVal[0]);
                }
            } else {
                if (metric.type == sparkplugDataType.dataSet) {
                    let newVal: sparkplugDataSet = { ...metric.value as sparkplugDataSet };
                    if (!Array.isArray(payload)) {
                        payload = [payload];
                    }
                    let dataSet: sparkplugValue[][] = [];
                    payload.forEach((row: any, i: number) => {
                        let arr: any[] = [];
                        (metric.value as sparkplugDataSet).columns.forEach((col) => {
                            arr.push(row[col]);
                        })
                        dataSet[i] = arr;
                    })

                    newVal.rows = dataSet;
                    return newVal;
                } else if (typeof payload === 'object' && payload.hasOwnProperty('value')) {
                    // If no path is provided but the object has a 'value' property, use that
                    return parseTypeFromString(metric.type, payload.value);
                }
            }
            break;
        case serialisationType.JSONBatched:
            // JSON (Batched) format should not be processed by this function
            // It should be handled directly in _handleData using processJSONBatchedPayload
            log('JSON (Batched) payloads should not be processed by parseValueFromPayload');
            return null;
        case serialisationType.XML:
            if (path) {
                const doc = new DOMParser().parseFromString(msg.toString());
                const xPathResults = xpath.select(path, doc);
                let res = xPathResults.toString();
                return parseTypeFromString(metric.type, res)
            }
            break;
        case serialisationType.fixedBuffer:
            // Parse path:bit or start:end format
            let _path = path;
            let bit: number | undefined;
            if (path.includes(':')) {
                const splitPath = path.split(':');
                _path = splitPath[0];
                bit = splitPath[1] ? parseInt(splitPath[1]) : undefined;
            }
            return parseValFromBuffer(
                metric.type,
                (typeof metric.properties !== "undefined" && typeof metric.properties.endianness !== "undefined" ? metric.properties.endianness.value as number : 0),
                parseInt(_path),
                msg as Buffer,
                bit);
        case serialisationType.serialisedBuffer:
            break;
        default:
            break;
    }
}

/**
 * Handles pass through of timestamp from device connection
 * Currently only supports JSON
 * @param msg
 * @param metric
 * @param payloadFormat
 * @param delimiter
 */
export function parseTimeStampFromPayload(msg: any, metric: sparkplugMetric, payloadFormat: serialisationType | string, delimiter?: string): number | undefined {
    let payload: any;
    switch (payloadFormat) {
        case serialisationType.JSON:
            try { // Handles error if invalid JSON is sent in
                if (typeof msg == "string") {
                    payload = JSON.parse(msg);
                } else if (Buffer.isBuffer(msg)) {
                    payload = JSON.parse(msg.toString());
                } else {
                    payload = msg;
                }
            } catch (e: any) {
                log('Failed to parse JSON data')
            }

            // Note: Array payloads are now handled in _handleData using processArrayPayload
            // This function only processes non-array payloads

            // Extract timestamp from the payload
            const timestamp = JSONPath({
                path: '$.timestamp',
                json: payload
            });

            const extractedTimestamp = Array.isArray(timestamp) ? timestamp[0] : undefined;

            // The timestamp will be a unix timestamp in milliseconds or
            // seconds, however upstream Factory+ expects it to be in
            // milliseconds. Here, we detect if the timestamp is in seconds
            // and convert it to milliseconds if necessary.

            if (extractedTimestamp) {
                if (isTimestampInMilliseconds(extractedTimestamp)) {
                    return extractedTimestamp;
                }

                return extractedTimestamp * 1000;
            }

            // If no timestamp found in the standard location, check if the payload itself has a timestamp or time property
            if (typeof payload === 'object') {
                if (payload.hasOwnProperty('timestamp')) {
                    const directTimestamp = payload.timestamp;
                    if (directTimestamp) {
                        if (isTimestampInMilliseconds(directTimestamp)) {
                            return directTimestamp;
                        }
                        return directTimestamp * 1000;
                    }
                } else if (payload.hasOwnProperty('time')) {
                    const directTimestamp = payload.time;
                    if (directTimestamp) {
                        if (isTimestampInMilliseconds(directTimestamp)) {
                            return directTimestamp;
                        }
                        return directTimestamp * 1000;
                    }
                }
            }

            return undefined;

        default:
            return undefined;
    }
}

function isTimestampInMilliseconds(timestamp: number) {
    // Convert the timestamp to a number (in case it's a string)
    timestamp = Number(timestamp);

    // Check if the timestamp is in milliseconds or seconds
    if (timestamp > 1e12) {
        // If it's larger than 1e12 (approximately 13 digits), it's in milliseconds
        return true;
    } else if (timestamp > 1e9 && timestamp <= 1e12) {
        // If it's between 1e9 and 1e12 (approximately 10 digits), it's in seconds
        return false;
    }

    // Return false by default if the timestamp is outside expected ranges
    return false;
}

function parseTypeFromString(type: string, val: any) {

    // Pass straight through if not a string
    if (typeof val !== 'string') {
        return val
    }

    let testVal: number;
    if (type.match(/[Ff]loat/) || type.match(/[Dd]ouble/)) {
        testVal = parseFloat(val);
        return isNaN(testVal) ? null : testVal;
    } else if (type.match(/[iI]nt/g)) {
        testVal = parseInt(val);
        return isNaN(testVal) ? null : testVal;
    } else if (type.match(/[Dd]ateTime/g)) {
        return Date.parse(val)
    } else if (type.match(/[Bb]oolean/g)) {
        return stringToBoolean(val);
    } else {
        return val;
    }
}

function stringToBoolean(string: string) {
    switch (string.toLowerCase()) {
        case "false":
        case "no":
        case "0":
        case "":
            return false;
        default:
            return true;
    }
}

/**
 * Function to prepare payload to send to a device connection
 * @param metrics
 * @param payloadFormat
 * @param delimiter
 */
export function writeValuesToPayload(metrics: sparkplugMetric[], payloadFormat: serialisationType | string, delimiter?: string): string | Buffer {
    let payload: any;
    switch (payloadFormat) {
        case serialisationType.JSON:
            payload = {};
            metrics.forEach((metric) => {
                if (typeof metric.properties !== "undefined" && typeof metric.properties.path !== "undefined") {

                    // Set the value of the metric based on the tagpath value (e.g. $.v)
                    const valPointer = JSONPath.toPointer(JSONPath.toPathArray(metric.properties.path.value as string));
                    jsonpointer.set(payload, valPointer, metric.value);
                }
            })
            return JSON.stringify(payload);
        case serialisationType.JSONBatched:
            // JSON (Batched) format creates an array of objects with value and timestamp
            payload = metrics.map((metric) => ({
                value: metric.value,
                timestamp: metric.timestamp || Date.now()
            }));
            return JSON.stringify(payload);
        case serialisationType.fixedBuffer:
            payload = Buffer.alloc(0);
            metrics.forEach((metric) => {
                if (payload.length) {
                    payload = Buffer.concat([payload, writeValToBuffer(metric)]);
                } else {
                    payload = writeValToBuffer(metric);
                }
            })
            if (payload && payload.length) {
                return payload;
            }
            return "";
        case serialisationType.serialisedBuffer:
            console.log(`Writing to serialised buffer payloads is not yet supported.`);
            return "";
        case serialisationType.XML:
            console.log(`Writing to XML payloads is not yet supported.`);
            return ""
        case serialisationType.delimited:
            payload = [];
            metrics.forEach((metric) => {
                payload.push(metric.value);
            });
            return payload.join(delimiter)
        default:
            return "";
    }
}

// Returns the number of bytes required to hold the variable type
// These are the fixed length variable types in the sparkplug spec.
// Variable length types (String, Buffer etc) are not considered... yet.
export function typeLens(type: string): number {
    switch (type) {
        case sparkplugDataType.boolean:
        case sparkplugDataType.int8:
        case sparkplugDataType.uInt8:
            return 1
        case sparkplugDataType.uInt16:
        case sparkplugDataType.int16:
            return 2
        case sparkplugDataType.uInt32:
        case sparkplugDataType.int32:
        case sparkplugDataType.float:
            return 4
        case sparkplugDataType.double:
            return 8
        case sparkplugDataType.dateTime:
            return 12
        default:
            return -1
    }
}

/**
 *
 * @param type Sparkplug Datatype of metric
 * @param endianness Endianness of metric
 * @param byteAddr Register address of metric
 * @param buf Buffer to read from
 * @param bit Bit position to read from within byte (optional)
 * @returns Value parsed from buffer
 */
export function parseValFromBuffer(type: sparkplugDataType, endianness: byteOrder, byteAddr: number, buf: Buffer, bit?: number): any {

    switch (type) {
        case sparkplugDataType.string:
            // For String type, byteAddr is start, bit is end (if provided)
            // This allows extracting string from buffer using start:end syntax
            try {
                if (bit !== undefined) {
                    // bit is repurposed as end position for strings
                    return buf.subarray(byteAddr, bit).toString('utf8');
                } else {
                    // Read from byteAddr to end of buffer
                    return buf.subarray(byteAddr).toString('utf8');
                }
            } catch (e) {
                log(`ERROR - Failed to extract string from buffer: ${e}`);
                return null;
            }
            
        case sparkplugDataType.boolean:
            if (bit != null) {
                return (!!(buf[byteAddr] & (1 << bit)));
            } else {
                return -1;
            }
        case sparkplugDataType.int8:
            return buf.readInt8(byteAddr);

        case sparkplugDataType.int16:
            if (endianness === byteOrder.bigEndian) return buf.readInt16BE(byteAddr); else return buf.readInt16LE(byteAddr);

        case sparkplugDataType.int32:
            if (endianness === byteOrder.bigEndian) return buf.readInt32BE(byteAddr); else return buf.readInt32LE(byteAddr);

        case sparkplugDataType.int64:
            if (endianness === byteOrder.bigEndian) return buf.readBigInt64BE(byteAddr); else return buf.readBigInt64LE(byteAddr);

        case sparkplugDataType.uInt8:
            return buf.readUInt8(byteAddr);

        case sparkplugDataType.uInt16:
            if (endianness === byteOrder.bigEndian) return buf.readUInt16BE(byteAddr); else return buf.readUInt16LE(byteAddr);
        case sparkplugDataType.uInt32:
            if (endianness === byteOrder.bigEndian) return buf.readUInt32BE(byteAddr); else return buf.readUInt32LE(byteAddr);

        case sparkplugDataType.uInt64:
            if (endianness === byteOrder.bigEndian) return buf.readBigUInt64BE(byteAddr); else return buf.readBigUInt64LE(byteAddr);

        case sparkplugDataType.float:
            if (endianness === byteOrder.bigEndian) return buf.readFloatBE(byteAddr); else return buf.readFloatLE(byteAddr);

        case sparkplugDataType.double:
            if (endianness === byteOrder.bigEndian) return buf.readDoubleBE(byteAddr); else return buf.readDoubleLE(byteAddr);

        default:
            log(`Type ${type} not supported for buffer parsing`);
            return undefined;
    }
}

export function writeValToBuffer(metric: sparkplugMetric): Buffer {
    // Writes out a variable of the specified metric.type type to output buffer buf
    // Datetime, string, and buffer are not implemented...yet
    let buf = Buffer.allocUnsafe(8);
    let len = 0;
    const endianness = metric.properties?.endianness?.value as byteOrder ?? byteOrder.bigEndian

    try {
        switch (metric.type) {
            case sparkplugDataType.boolean:
                len = buf.writeUInt8(metric.value ? 1 : 0);
                break;
            case sparkplugDataType.int8:
                len = buf.writeInt8(metric.value as number);
                break;

            case sparkplugDataType.int16:
                if (endianness === byteOrder.bigEndian) len = buf.writeInt16BE(metric.value as number); else len = buf.writeInt16LE(metric.value as number);
                break;

            case sparkplugDataType.int32:
                if (endianness === byteOrder.bigEndian) len = buf.writeInt32BE(metric.value as number); else len = buf.writeInt32LE(metric.value as number);
                break;

            case sparkplugDataType.int64:
                if (endianness === byteOrder.bigEndian) len = buf.writeBigInt64BE(metric.value as bigint); else len = buf.writeBigInt64LE(metric.value as bigint);
                break;

            case sparkplugDataType.uInt8:
                len = buf.writeUInt8(metric.value as number);
                break;

            case sparkplugDataType.uInt16:
                if (endianness === byteOrder.bigEndian) len = buf.writeUInt16BE(metric.value as number); else len = buf.writeUInt16LE(metric.value as number);
                break;
            case sparkplugDataType.uInt32:
                if (endianness === byteOrder.bigEndian) len = buf.writeUInt32BE(metric.value as number); else len = buf.writeUInt32LE(metric.value as number);
                break;

            case sparkplugDataType.uInt64:
                if (endianness === byteOrder.bigEndian) len = buf.writeBigUInt64BE(metric.value as bigint); else len = buf.writeBigUInt64LE(metric.value as bigint);
                break;

            case sparkplugDataType.float:
                if (endianness === byteOrder.bigEndian) len = buf.writeFloatBE(metric.value as number); else len = buf.writeFloatLE(metric.value as number);
                break;

            case sparkplugDataType.double:
                if (endianness === byteOrder.bigEndian) len = buf.writeDoubleBE(metric.value as number); else len = buf.writeDoubleLE(metric.value as number);
                break;

            default:
                throw new Error(`Type ${metric.type} not supported for buffer parsing`);
        }

        return buf.slice(0, len);
    } catch (err) {
        console.log(err);
        return buf.slice(0);
    }
}

/**
 * Converting OPC Security Policy to correct class type
 * @param type Security policy type as string (e.g. "Basic256Sha256", "None", etc.)
 * @returns OPC Security Policy type
 */
export function getOpcSecurityPolicy(type: string): SecurityPolicy {
    switch (type) {
        case ("None"):
            return SecurityPolicy.None;
        case ("Basic128"):
            return SecurityPolicy.Basic128;
        case ("Basic192"):
            return SecurityPolicy.Basic192;
        case ("Basic192Rsa15"):
            return SecurityPolicy.Basic192Rsa15;
        case ("Basic256Rsa15"):
            return SecurityPolicy.Basic256Rsa15;
        case ("Basic256Sha256"):
            return SecurityPolicy.Basic256Sha256;
        case ("Aes128_Sha256"):
            return SecurityPolicy.Aes128_Sha256_RsaOaep;
        case ("Aes128_Sha256_RsaOaep"):
            return SecurityPolicy.Aes128_Sha256_RsaOaep;
        case ("PubSub_Aes128_CTR"):
            return SecurityPolicy.PubSub_Aes128_CTR;
        case ("PubSub_Aes256_CTR"):
            return SecurityPolicy.PubSub_Aes256_CTR;
        case ("Basic128Rsa15"):
            return SecurityPolicy.Basic128Rsa15;
        case ("Basic256"):
            return SecurityPolicy.Basic256;
        default:
            return SecurityPolicy.Invalid;
    }
}

/**
 * Converting OPC Security Mode to correct class type
 * @param type Security mode type as string (e.g. "Sign", "None", "SignAndEncrypt".)
 * @returns OPC Security Mode type
 */
export function getOpcSecurityMode(type: string): MessageSecurityMode {
    switch (type) {
        case ("None"):
            return MessageSecurityMode.None;
        case ("Sign"):
            return MessageSecurityMode.Sign;
        case ("SignAndEncrypt"):
            return MessageSecurityMode.SignAndEncrypt;
        default:
            return MessageSecurityMode.Invalid;
    }
}
