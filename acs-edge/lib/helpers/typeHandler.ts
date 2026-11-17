/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { JSONPath } from "jsonpath-plus";
import * as vm from "vm";
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
    timestamp: number | Long,
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
    /** Millisecond timestamp, or a Long encoding nanoseconds when set by
     *  SparkplugNode for wire encoding. Prefer timestampNs for precision. */
    timestamp?: number | Long,
    /** Nanoseconds since epoch. When present, takes precedence over
     *  timestamp for encoding. Set by drivers that supply sub-ms precision. */
    timestampNs?: bigint,
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
    /* Simulated-data markers, set from simulator driver payloads */
    simulated?: sparkplugMetricProperty,
    run_id?: sparkplugMetricProperty,
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

/* Captured once at startup to align hrtime with wall clock.
 * Date.now() is millisecond-precision so absolute accuracy is ±1ms,
 * but relative precision between events is genuinely nanosecond.
 * process.hrtime.bigint() is monotonic so timestamps never go backwards. */
const HRTIME_OFFSET = BigInt(Date.now()) * 1_000_000n - process.hrtime.bigint();

export function now_ns(): bigint {
    return process.hrtime.bigint() + HRTIME_OFFSET;
}

export class Metrics {
    #array: sparkplugMetric[]
    #addrIndex: metricArrIndex
    #addrPathIndex: metricAddrPathGroup
    #nameIndex: metricIndex
    #aliasIndex: metricIndex

    constructor(metricArr: sparkplugMetric[]) {
        this.#array = metricArr;
        /* Null-prototype objects, because a name, address or path can
         * be any string, "__proto__" and "constructor" included. */
        this.#nameIndex = Object.create(null);
        this.#aliasIndex = Object.create(null);
        this.#addrPathIndex = Object.create(null);
        this.#addrIndex = Object.create(null);
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
                if (!this.#addrPathIndex[addr]) {
                    this.#addrPathIndex[addr] = Object.create(null);
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

    setValueByName(name: string, value: sparkplugValue, timestamp?: number, timestampNs?: bigint) {
        this.#array[this.#nameIndex[name]].value = value;
        this.#array[this.#nameIndex[name]].timestamp = timestamp || Date.now();
        this.#array[this.#nameIndex[name]].timestampNs = timestampNs ?? (timestamp ? undefined : now_ns());
        this.#array[this.#nameIndex[name]].isNull = (value === null);
        return this.#array[this.#nameIndex[name]]
    }

    setValueByIndex(index: number, value: sparkplugValue, timestamp?: number, timestampNs?: bigint) {
        this.#array[index].value = value;
        this.#array[index].timestamp = timestamp || Date.now();
        this.#array[index].timestampNs = timestampNs ?? (timestamp ? undefined : now_ns());
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

    setValueByAlias(alias: number, value: sparkplugValue, timestamp?: number, timestampNs?: bigint) {
        this.#array[this.#aliasIndex[alias]].value = value;
        this.#array[this.#aliasIndex[alias]].timestamp = timestamp || Date.now();
        this.#array[this.#aliasIndex[alias]].timestampNs = timestampNs ?? (timestamp ? undefined : now_ns());
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

    setValueByAddrPath(addr: string, path: string, value: sparkplugValue, timestamp?: number, timestampNs?: bigint) {
        this.#array[this.#addrPathIndex[addr][path]].value = value;
        this.#array[this.#addrPathIndex[addr][path]].timestamp = timestamp || Date.now();
        this.#array[this.#addrPathIndex[addr][path]].timestampNs = timestampNs ?? (timestamp ? undefined : now_ns());
        this.#array[this.#addrPathIndex[addr][path]].isNull = (value === null)
        return this.#array[this.#addrPathIndex[addr][path]];
    }

    // removeByAddrPath(addr: string, path: string) {
    //     const spliced = this.#array.splice(this.#addrPathIndex[addr][path], 1);
    //     this.#buildIndices();
    //     return spliced;
    // }
}



/* jsonpath-plus 5 runs each filter script, such as the
 * "@.name=='ActLoad'" in $.set.datapoints[?(@.name=='ActLoad')].value,
 * with vm.runInNewContext: a new V8 context for every JSONPath call and
 * a fresh compile for every array element it tests. That cost 170 to
 * 290 us per metric for a filter over 10 to 100 elements, far more
 * than parsing the payload.
 *
 * So each path string gets one JSONPath object, made once and reused,
 * whose vm compiles each script once and runs it in one shared
 * context. jsonpath-plus sets every variable a script reads (_$_v,
 * _$_root and so on) on that context before it runs the script, so a
 * script sees what it saw in its own context. Only a script that sets
 * a global of its own would now see it again next time, which no
 * metric path does. */
const jsonpath_context = vm.createContext({});
const jsonpath_scripts = new Map<string, vm.Script>();
const jsonpath_vm = {
    runInNewContext (code: string, sandbox: any) {
        let script = jsonpath_scripts.get(code);
        if (!script) {
            script = new vm.Script(code);
            jsonpath_scripts.set(code, script);
        }
        return script.runInContext(vm.isContext(sandbox)
            ? sandbox : vm.createContext(sandbox));
    },
};
const jsonpath_cache = new Map<string, any>();

/* JSONPath({ path, json }), with the path compiled once. */
function query_json (path: string, json: any): any {
    let jp = jsonpath_cache.get(path);
    if (!jp) {
        jp = new (JSONPath as any)({
            autostart: false, path, sandbox: jsonpath_context });
        jp.vm = jsonpath_vm;
        jsonpath_cache.set(path, jp);
    }
    /* @root reads the json the object was made with */
    jp.json = json;
    try {
        return jp.evaluate(path, json);
    }
    finally {
        jp.json = undefined;
    }
}

/**
 * Processes a JSON batched payload and returns an array of values and timestamps
 * This function expects an array of objects and uses the metric's path to extract values
 * @param payload The JSON array payload to process
 * @param metric The metric to use for processing (including path configuration)
 * @returns An array of objects with value, timestamp and timestampNs properties
 */
export function processJSONBatchedPayload(payload: any[], metric: sparkplugMetric): { value: any, timestamp?: number, timestampNs?: bigint }[] {
    const results: { value: any, timestamp?: number, timestampNs?: bigint }[] = [];
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
                : query_json(path, item);

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

        // Extract a nanosecond-precision timestamp if available. As with
        // parseNsTimestampFromPayload, this must be a numeric string (not a
        // number) to avoid float64 precision loss.
        let timestampNs: bigint | undefined;
        if (item.timestampNs != null) {
            try {
                timestampNs = BigInt(item.timestampNs);
            } catch {
                log(`JSON (Batched) payload item ${index} has invalid timestampNs: ${item.timestampNs}`);
            }
        }

        results.push({ value, timestamp, timestampNs });
    });

    return results;
}



/* Decode a JSON payload the way every reader below always has: a string
 * or Buffer is parsed, anything else (REST hands over a parsed object)
 * is used as it is, and invalid JSON gives undefined. */
function decode_json (msg: any): { value: any, err?: any } {
    try {
        if (typeof msg == "string") return { value: JSON.parse(msg) };
        if (Buffer.isBuffer(msg)) return { value: JSON.parse(msg.toString()) };
        return { value: msg };
    }
    catch (err: any) {
        return { value: undefined, err };
    }
}

/**
 * One payload for one address, decoded at most once.
 *
 * Device._handleData reads every metric on an address from the same
 * payload. It used to hand each reader the raw message, so the payload
 * was parsed again for every metric (and up to three more times when
 * the value changed). Wrap the message in one of these instead and the
 * JSON value, XML document or delimited fields are worked out on first
 * use and shared by every metric. Decoding is lazy so a payload is only
 * decoded if a metric needs it, as before.
 *
 * Nothing in the read path changes the decoded payload: values are read
 * out of it, and a metric whose value is an object holds a reference
 * into it, as REST payloads (already parsed by axios) always have.
 */
export class DecodedPayload {
    readonly raw: any;
    #json?: { value: any, err?: any };
    #json_warned = false;
    #xml?: { doc?: any, err?: any };
    #fields?: { value: any };

    constructor (raw: any) {
        this.raw = raw;
    }

    /* The JSON decode as { value, err }, with err set if the payload is
     * not valid JSON. Logs nothing. */
    json_result (): { value: any, err?: any } {
        if (!this.#json) this.#json = decode_json(this.raw);
        return this.#json;
    }

    /* The payload as a JSON value, or undefined if it is not valid
     * JSON. Logs a parse failure once per message. */
    json (): any {
        const res = this.json_result();
        if ("err" in res && !this.#json_warned) {
            this.#json_warned = true;
            log('Failed to parse JSON data');
        }
        return res.value;
    }

    /* The XML document. If parsing threw, every caller gets the same
     * error, as each metric did when it parsed for itself. */
    xml (): any {
        if (!this.#xml) {
            try { this.#xml = { doc: new DOMParser().parseFromString(this.raw.toString()) }; }
            catch (err) { this.#xml = { err }; }
        }
        if ("err" in this.#xml) throw this.#xml.err;
        return this.#xml.doc;
    }

    /* Delimited String fields, or the whole string with no delimiter. */
    fields (delimiter?: string): any {
        if (!this.#fields) {
            this.#fields = { value: (delimiter != '')
                ? this.raw.toString().split(delimiter) : this.raw.toString() };
        }
        return this.#fields.value;
    }
}

function as_decoded (msg: any): DecodedPayload {
    return msg instanceof DecodedPayload ? msg : new DecodedPayload(msg);
}

/* Compiled XPath expressions by path string. A path that fails to
 * compile maps to null, and is passed to xpath.select each time so it
 * throws exactly the error it always has. */
const xpath_cache = new Map<string, any>();

/* Exported by the xpath package but missing from its types */
const XPathResult = (xpath as any).XPathResult;

function compiled_xpath (path: string): any {
    let expr = xpath_cache.get(path);
    if (expr === undefined) {
        try { expr = (xpath as any).createExpression(path, null); }
        catch { expr = null; }
        xpath_cache.set(path, expr);
    }
    return expr;
}

/* xpath.select(path, doc), with the expression compiled once. This is
 * what select does inside: evaluate as ANY_TYPE and unwrap the result. */
function select_xpath (path: string, doc: any): any {
    const expr = compiled_xpath(path);
    /* Keep the old error for a document that did not parse */
    if (expr === null || !doc) return xpath.select(path, doc);
    const res = expr.evaluate(doc, XPathResult.ANY_TYPE, null);
    switch (res.resultType) {
        case XPathResult.STRING_TYPE:     return res.stringValue;
        case XPathResult.NUMBER_TYPE:     return res.numberValue;
        case XPathResult.BOOLEAN_TYPE:    return res.booleanValue;
        default:                                return res.nodes;
    }
}

/**
 * Read one metric's value from a payload.
 * @param msg The raw message, or a DecodedPayload to share one decode
 *  between every metric on the address.
 */
export function parseValueFromPayload(msg: any, metric: sparkplugMetric, payloadFormat: serialisationType | string, delimiter?: string) {
    let payload: any;
    const decoded = as_decoded(msg);
    msg = decoded.raw;
    const path = (typeof metric.properties !== "undefined" && typeof metric.properties.path !== "undefined" ? metric.properties.path.value as string : "");
    switch (payloadFormat) {
        case serialisationType.delimited:
            // Handle no delimiter
            payload = decoded.fields(delimiter);

            // Handle no path parsing
            if (path == null || path == '') {
                return parseTypeFromString(metric.type, payload);
            } else {
                return parseTypeFromString(metric.type, payload[path]);
            }
        case serialisationType.JSON:
            // Undefined if invalid JSON is sent in
            payload = decoded.json();

            // Note: Array payloads are now handled in _handleData using processArrayPayload
            // This function only processes non-array payloads or is called for a single item

            if (path) {
                /* Work around a bug in the JSONPath library */
                let newVal = path === "$" && payload === false
                    ? [false]
                    : query_json(path, payload);
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
                    // If no path is provided but the object has a 'value' property, use that.
                    // A Buffer sent as JSON ({"type": "Buffer", "data": [...]}, how
                    // JSON.stringify writes one and how edge-opcua sends a ByteString)
                    // becomes a Buffer again, as the path branch above does.
                    let val = payload.value;
                    if (val?.type === "Buffer") {
                        val = Buffer.from(val.data);
                    }
                    return parseTypeFromString(metric.type, val);
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
                const doc = decoded.xml();
                const xPathResults = select_xpath(path, doc);
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
            /* Nothing here knows how to read this payload, so the metric
             * gets no value. Say so.
             *
             * This branch used to return undefined in silence, and the
             * commonest way to reach it is a real misconfiguration: an
             * external driver connection left on "Defined by Protocol".
             * Such a driver hands over a raw Buffer expecting the Edge Agent
             * to parse it, so the data arrives intact, is discarded here
             * without a word, and the metric sits at null forever. There is
             * nothing in the logs, nothing in the birth certificate, and no
             * error anywhere to suggest the payload ever existed.
             *
             * Logged once per format so a per-metric, per-poll hot path
             * cannot flood the log. */
            warn_unparsed(payloadFormat);
            break;
    }
}

/* Payload formats already complained about; see the default branch above. */
const unparsed_warned = new Set<string>();

function warn_unparsed (payloadFormat: serialisationType | string) {
    const key = String(payloadFormat);
    if (unparsed_warned.has(key)) return;
    unparsed_warned.add(key);

    log(`Payload format "${key}" has no parser, so every metric using it `
        + `will stay empty. If this connection uses an external driver, the `
        + `driver sends a payload for the Edge Agent to decode and the format `
        + `must name it, usually JSON. "Defined by Protocol" only suits `
        + `connections that decode internally.`);
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
            // Undefined if invalid JSON is sent in
            payload = as_decoded(msg).json();

            // Note: Array payloads are now handled in _handleData using processArrayPayload
            // This function only processes non-array payloads

            // Extract timestamp from the payload. This is what
            // JSONPath "$.timestamp" gives: nothing for a falsy payload,
            // and the property only if it is the payload's own.
            const extractedTimestamp = payload
                && Object.prototype.hasOwnProperty.call(payload, "timestamp")
                ? payload.timestamp : undefined;

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

/**
 * Extracts a nanosecond-precision timestamp from a JSON payload.
 * The field must be named "timestampNs" and must be a numeric string
 * (not a number) to avoid float64 precision loss — nanosecond epoch
 * values exceed Number.MAX_SAFE_INTEGER.
 * Currently only supports JSON payloads; other formats return undefined.
 * @param msg Raw message from device connection
 * @param metric The metric being processed
 * @param payloadFormat Payload format string
 */
/* Simulated-data markers: the simulator driver stamps every payload
 * with simulated: true and a per-run UUID so the historians can tag
 * the data. Only JSON payloads can carry them. */
export function parseSimTagsFromPayload(msg: any, payloadFormat: serialisationType | string): { simulated?: boolean, run_id?: string } {
    if (payloadFormat !== serialisationType.JSON) return {};
    const payload = as_decoded(msg).json();
    if (typeof payload !== "object" || payload === null) return {};
    const out: { simulated?: boolean, run_id?: string } = {};
    if (payload.simulated === true) out.simulated = true;
    if (typeof payload.run_id === "string") out.run_id = payload.run_id;
    return out;
}

export function parseNsTimestampFromPayload(msg: any, metric: sparkplugMetric, payloadFormat: serialisationType | string): bigint | undefined {
    if (payloadFormat !== serialisationType.JSON) return undefined;

    // Undefined if invalid JSON is sent in
    const payload = as_decoded(msg).json();

    const raw = payload?.timestampNs;
    if (raw == null) return undefined;

    try {
        return BigInt(raw);
    } catch {
        log(`Failed to parse timestampNs value as BigInt: ${raw}`);
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
                /* Skip a value that can't be written rather than
                 * sending bytes that don't mean anything. */
                let bytes: Buffer;
                try {
                    bytes = writeValToBuffer(metric);
                }
                catch (err) {
                    log(`Can't write ${metric.name}: ${(err as Error).message}`);
                    return;
                }
                payload = Buffer.concat([payload, bytes]);
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

/* Convert a value written to a 64-bit integer metric to a BigInt.
 * A DCMD value arrives as a Long, which the device turns into a JS
 * number, so precision above 2^53 is already lost by the time it gets
 * here. Throws if the value isn't an integer in range. */
export function toBigInt64(value: unknown, signed: boolean): bigint {
    let big: bigint;
    if (typeof value == "bigint")
        big = value;
    else if (Long.isLong(value))
        big = BigInt((value as Long).toString());
    else if (typeof value == "number") {
        if (!Number.isFinite(value))
            throw new Error(`Can't write ${value} as a 64-bit integer`);
        big = BigInt(Math.trunc(value));
    }
    else if (typeof value == "string" && /^\s*-?\d+\s*$/.test(value))
        big = BigInt(value.trim());
    else
        throw new Error(`Can't write ${String(value)} as a 64-bit integer`);

    const fits = signed ? BigInt.asIntN(64, big) : BigInt.asUintN(64, big);
    if (fits != big)
        throw new Error(`${big} is out of range for ${signed ? "Int64" : "UInt64"}`);
    return big;
}

/* Write a metric's value as raw bytes for its Sparkplug type. This is
 * the payload of a cmd to a split driver and of a Buffer-format write.
 * Throws if the type isn't supported or the value doesn't fit it. */
export function writeValToBuffer(metric: sparkplugMetric): Buffer {
    if (metric.type !== sparkplugDataType.dateTime)
        refuse_null(metric);
    const buf = Buffer.alloc(8);
    const endianness = metric.properties?.endianness?.value as byteOrder ?? byteOrder.bigEndian;
    const be = endianness === byteOrder.bigEndian;
    let len: number;

    switch (metric.type) {
        case sparkplugDataType.boolean:
            len = buf.writeUInt8(metric.value ? 1 : 0);
            break;
        case sparkplugDataType.int8:
            len = buf.writeInt8(metric.value as number);
            break;
        case sparkplugDataType.int16:
            len = be ? buf.writeInt16BE(metric.value as number) : buf.writeInt16LE(metric.value as number);
            break;
        case sparkplugDataType.int32:
            len = be ? buf.writeInt32BE(metric.value as number) : buf.writeInt32LE(metric.value as number);
            break;
        case sparkplugDataType.int64: {
            const v = toBigInt64(metric.value, true);
            len = be ? buf.writeBigInt64BE(v) : buf.writeBigInt64LE(v);
            break;
        }
        case sparkplugDataType.uInt8:
            len = buf.writeUInt8(metric.value as number);
            break;
        case sparkplugDataType.uInt16:
            len = be ? buf.writeUInt16BE(metric.value as number) : buf.writeUInt16LE(metric.value as number);
            break;
        case sparkplugDataType.uInt32:
            len = be ? buf.writeUInt32BE(metric.value as number) : buf.writeUInt32LE(metric.value as number);
            break;
        case sparkplugDataType.uInt64: {
            const v = toBigInt64(metric.value, false);
            len = be ? buf.writeBigUInt64BE(v) : buf.writeBigUInt64LE(v);
            break;
        }
        case sparkplugDataType.float:
            len = be ? buf.writeFloatBE(metric.value as number) : buf.writeFloatLE(metric.value as number);
            break;
        case sparkplugDataType.double:
            len = be ? buf.writeDoubleBE(metric.value as number) : buf.writeDoubleLE(metric.value as number);
            break;
        case sparkplugDataType.string:
        case sparkplugDataType.text:
        case sparkplugDataType.uuid:
            /* Variable length: written as UTF-8, not into the
             * fixed 8-byte buffer. */
            return Buffer.from(String(metric.value ?? ""), "utf8");
        default:
            throw new Error(`Type ${metric.type} not supported for buffer writes`);
    }

    return buf.subarray(0, len);
}

/* A command with no value (a Sparkplug null) has nothing to write.
 * Coerced, it would reach the device as 0, false or an empty string,
 * so refuse it. Only for the types a write can carry: any other type
 * is refused as unsupported, with its own message. */
function refuse_null (metric: sparkplugMetric) {
    if (metric.value !== null && metric.value !== undefined) return;
    if (!TYPED_WRITE_TYPES.has(metric.type)) return;
    throw new Error(`${metric.name ?? "The metric"} has no value to write`);
}

/* The Sparkplug types a typed write can carry. */
export const TYPED_WRITE_TYPES: ReadonlySet<string> = new Set([
    sparkplugDataType.boolean,
    sparkplugDataType.int8, sparkplugDataType.int16,
    sparkplugDataType.int32, sparkplugDataType.int64,
    sparkplugDataType.uInt8, sparkplugDataType.uInt16,
    sparkplugDataType.uInt32, sparkplugDataType.uInt64,
    sparkplugDataType.float, sparkplugDataType.double,
    sparkplugDataType.string, sparkplugDataType.text,
    sparkplugDataType.uuid, sparkplugDataType.dateTime,
]);

const INT_RANGES: Record<string, [number, number]> = {
    [sparkplugDataType.int8]:   [-0x80, 0x7f],
    [sparkplugDataType.int16]:  [-0x8000, 0x7fff],
    [sparkplugDataType.int32]:  [-0x80000000, 0x7fffffff],
    [sparkplugDataType.uInt8]:  [0, 0xff],
    [sparkplugDataType.uInt16]: [0, 0xffff],
    [sparkplugDataType.uInt32]: [0, 0xffffffff],
};

/* Write a metric's value as the JSON payload of a typed write to a
 * split driver: {"type": <Sparkplug type>, "value": <value>}. Int64
 * and UInt64 values are decimal strings, so a driver gets every digit.
 * Float and Double NaN and infinities are the strings "NaN",
 * "Infinity" and "-Infinity", which JSON can't hold as numbers.
 * DateTime is milliseconds since the epoch. See docs/edge-split.md.
 * Throws if the type isn't supported or the value doesn't fit it. */
export function writeValToJSON(metric: sparkplugMetric): Buffer {
    refuse_null(metric);
    const { type } = metric;
    const value = metric.value as any;
    let out: boolean | number | string;

    switch (type) {
        case sparkplugDataType.boolean:
            out = typeof value == "string"
                ? value.trim().toLowerCase() == "true"
                : Boolean(value);
            break;
        case sparkplugDataType.int8:
        case sparkplugDataType.int16:
        case sparkplugDataType.int32:
        case sparkplugDataType.uInt8:
        case sparkplugDataType.uInt16:
        case sparkplugDataType.uInt32: {
            const n = Math.trunc(Long.isLong(value) ? value.toNumber() : Number(value));
            const [min, max] = INT_RANGES[type];
            if (!Number.isFinite(n) || n < min || n > max)
                throw new Error(`${String(value)} is out of range for ${type}`);
            out = n;
            break;
        }
        case sparkplugDataType.int64:
        case sparkplugDataType.uInt64:
            out = toBigInt64(value, type == sparkplugDataType.int64).toString();
            break;
        case sparkplugDataType.float:
        case sparkplugDataType.double: {
            const n = Number(value);
            out = Number.isFinite(n) ? n : String(n);
            break;
        }
        case sparkplugDataType.string:
        case sparkplugDataType.text:
        case sparkplugDataType.uuid:
            out = String(value ?? "");
            break;
        case sparkplugDataType.dateTime: {
            const n = value instanceof Date ? value.getTime()
                : Long.isLong(value) ? value.toNumber()
                : Number(value);
            if (!Number.isFinite(n))
                throw new Error(`${String(value)} is not a valid DateTime`);
            out = Math.trunc(n);
            break;
        }
        default:
            throw new Error(`Type ${type} not supported for typed writes`);
    }

    return Buffer.from(JSON.stringify({ type, value: out }));
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
