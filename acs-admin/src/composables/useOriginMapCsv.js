/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import Papa from 'papaparse';
import { ISA95_HIERARCHY_KEY } from '@/store/useISA95Store.js';
// No 'set' export from vue in Vue 3. Use plain assignment; reactivity is handled by the parent component's set helper if needed.

const RESERVED_KEYS = ['Schema_UUID', 'Instance_UUID', 'patternProperties', '$meta', 'required'];

/* Mint a v4 UUID without depending on a crypto global being present
 * (browser and node both provide one; some test sandboxes don't). */
function mintUuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.floor(Math.random() * 16);
        const v = c === 'x' ? r : (r % 4) + 8;
        return v.toString(16);
    });
}

/**
 * Read the value at a path of segments, without creating anything along the
 * way. Returns undefined if any segment is missing.
 */
function valueAt(obj, segments) {
    let current = obj;
    for (const segment of segments) {
        if (current == null || typeof current !== 'object') return undefined;
        current = current[segment];
    }
    return current;
}

/**
 * Determine the node type of a schema property.
 * @param {object} prop - A value from schema.properties
 * @returns {'metric'|'object'|'schemaArray'|'unknown'}
 */
function nodeType(prop) {
    if (!prop || typeof prop !== 'object') return 'unknown';
    if ('allOf' in prop) return 'metric';
    if ('properties' in prop) return 'object';
    if ('patternProperties' in prop) return 'schemaArray';
    return 'unknown';
}

/**
 * Recursively walk the schema tree and collect metric rows that have
 * values in the model.
 *
 * @param {object} schema - The current schema node (must have .properties)
 * @param {object} model  - The current model node
 * @param {string[]} pathSegments - Accumulated path segments for the tag path
 * @returns {Array<{tagPath: string, metricSchema: object, modelValues: object}>}
 */
function collectMetricRows(schema, model, pathSegments = [], inPlaceholder = false) {
    const rows = [];

    if (!schema?.properties) return rows;

    const keys = Object.keys(schema.properties).filter(
        k => !RESERVED_KEYS.includes(k),
    );

    for (const key of keys) {
        const prop = schema.properties[key];
        const type = nodeType(prop);
        const currentPath = [...pathSegments, key];

        if (type === 'metric') {
            // Include all metric leaf nodes from the schema.
            // Populate with current model values if they exist, empty otherwise.
            const metricSchema = {
                ...prop.allOf[0]?.properties,
                ...prop.allOf[1]?.properties,
            };
            const modelValue = model?.[key];
            rows.push({
                tagPath: currentPath.join('/'),
                metricSchema,
                modelValues: (modelValue && typeof modelValue === 'object') ? modelValue : {},
            });
        } else if (type === 'object') {
            // Recurse into the child object
            rows.push(...collectMetricRows(prop, model?.[key], currentPath, inPlaceholder));
        } else if (type === 'schemaArray' && prop.patternProperties) {
            // For arrays, walk each instance in the model if present, otherwise just walk the schema
            const regexKey = Object.keys(prop.patternProperties)[0];
            const schemaForArray = prop.patternProperties[regexKey];
            const modelArray = model?.[key] || {};
            // If there are instances in the model, walk them
            for (const instanceKey of Object.keys(modelArray)) {
                rows.push(...collectMetricRows(schemaForArray, modelArray[instanceKey], [...currentPath, instanceKey], false));
            }
            // Add a placeholder row for the pattern when no instances exist, but only if we are
            // not already generating placeholder rows — prevents infinite recursion when nested
            // schemaArray properties have no model data.
            if (Object.keys(modelArray).length === 0 && !inPlaceholder) {
                rows.push(...collectMetricRows(schemaForArray, undefined, [...currentPath, '<new>'], true));
            }
        }
    }

    return rows;
}

/**
 * Apply CSV rows to the model, using a set function for reactivity.
 * @param {Array} rows - CSV rows
 * @param {Object} model - The model to mutate
 * @param {Object} schema - The schema
 * @param {Function} setFn - (optional) function(path, value, obj, delimiter) to set nested properties reactively
 * @returns {{applied: number, skipped: number, ignored: number, placeholders: number}}
 *   skipped counts rows whose path is absent from the schema; ignored counts
 *   ISA-95 hierarchy rows whose value the CSV tried to change; placeholders
 *   counts '<new>' template rows that never represent a real instance.
 */
export function applyCsvToModel(rows, model, schema, setFn) {
    let applied = 0;
    let skipped = 0;
    let ignored = 0;
    let placeholders = 0;

    const setPath = (pathArr, value) => {
        if (typeof setFn === 'function') {
            setFn(pathArr.join('.'), value, model, '.');
        } else {
            let current = model;
            for (let i = 0; i < pathArr.length - 1; i++) {
                if (current[pathArr[i]] == null || typeof current[pathArr[i]] !== 'object')
                    current[pathArr[i]] = {};
                current = current[pathArr[i]];
            }
            current[pathArr[pathArr.length - 1]] = value;
        }
    };

    /* Property keys may themselves contain '/' (the export joins path
     * segments with '/', so a key like "Player/Load" is
     * indistinguishable from nesting in the CSV). Resolve by longest
     * prefix match against the schema's actual keys instead of
     * assuming one segment per key. */
    function matchProperty(props, segments, start) {
        const rest = segments.slice(start).join('/');
        let best = null;
        for (const key of Object.keys(props)) {
            if (RESERVED_KEYS.includes(key)) continue;
            if (rest === key || rest.startsWith(key + '/')) {
                if (!best || key.length > best.key.length)
                    best = { key, consumed: key.split('/').length };
            }
        }
        return best;
    }

    /* Every schema-instance level in the model needs its Schema_UUID
     * (from the schema) and a minted Instance_UUID, or the editor
     * cannot render it and the platform cannot type it. This mirrors
     * what the editor's own metric-set path stamps. Heals levels that
     * already exist without markers, too. */
    function ensureMarkers(node, nodeSchema, pathArr) {
        const su = nodeSchema?.properties?.Schema_UUID?.const;
        if (!su) return;
        if (node.Schema_UUID == null)
            setPath([...pathArr, 'Schema_UUID'], su);
        if (node.Instance_UUID == null)
            setPath([...pathArr, 'Instance_UUID'], mintUuid());
    }

    for (const { tagPath, fields } of rows) {
        const segments = tagPath.split('/');

        // The ISA-95 hierarchy is a controlled vocabulary, managed exclusively
        // by ISA95HierarchyPanel. Never let free-text CSV values write to it.
        // Skip before traversal so we don't create the parent objects either.
        if (segments.includes(ISA95_HIERARCHY_KEY)) {
            // Only report rows where the CSV would actually have changed the
            // value, so an unmodified round-trip stays quiet.
            const csvValue = String(fields.Value ?? '').trim();
            const modelValue = String(valueAt(model, segments)?.Value ?? '');
            if (csvValue !== modelValue) ignored++;
            continue;
        }

        // '<new>' is the export's placeholder for a schema array with no
        // instances. It is never a real instance name; importing it
        // creates a phantom device object.
        if (segments.includes('<new>')) {
            placeholders++;
            console.warn('applyCsvToModel: placeholder instance row skipped:', tagPath);
            continue;
        }

        /* Walk schema and model together. */
        let schemaNode = schema;
        const modelPath = [];
        let i = 0;
        let ok = true;
        let leaf = null;

        while (i < segments.length) {
            if (!schemaNode) { ok = false; break; }

            // Schema array: the next segment is an instance name.
            if (schemaNode.patternProperties) {
                const regexKey = Object.keys(schemaNode.patternProperties)[0];
                const itemSchema = schemaNode.patternProperties[regexKey];
                const name = segments[i];
                modelPath.push(name);
                let inst = valueAt(model, modelPath);
                if (inst == null || typeof inst !== 'object') {
                    setPath(modelPath, {});
                    inst = valueAt(model, modelPath);
                }
                ensureMarkers(inst, itemSchema, modelPath);
                schemaNode = itemSchema;
                i += 1;
                continue;
            }

            if (!schemaNode.properties) { ok = false; break; }
            const m = matchProperty(schemaNode.properties, segments, i);
            if (!m) {
                console.warn('applyCsvToModel: no schema property matches', segments.slice(i).join('/'), 'for', tagPath);
                ok = false;
                break;
            }
            const childSchema = schemaNode.properties[m.key];
            modelPath.push(m.key);
            const isLast = i + m.consumed >= segments.length;

            if (isLast) {
                // Leaf: must be a metric (allOf carries the metric schema).
                if (!childSchema.allOf) {
                    console.warn('applyCsvToModel: leaf is not a metric for', tagPath);
                    ok = false;
                    break;
                }
                let metric = valueAt(model, modelPath);
                if (metric == null || typeof metric !== 'object') {
                    const metricSchema = {
                        ...childSchema.allOf[0]?.properties,
                        ...childSchema.allOf[1]?.properties,
                    };
                    const newMetric = {};
                    Object.keys(metricSchema).forEach(key => {
                        if ('const' in metricSchema[key]) {
                            newMetric[key] = metricSchema[key].const;
                        } else if ('default' in metricSchema[key]) {
                            newMetric[key] = metricSchema[key].default;
                        } else if ('enum' in metricSchema[key]) {
                            newMetric[key] = metricSchema[key].enum[0];
                        }
                    });
                    setPath(modelPath, newMetric);
                    metric = valueAt(model, modelPath);
                }
                leaf = metric;
                i += m.consumed;
                break;
            }

            // Intermediate group: create if missing, stamp markers.
            let group = valueAt(model, modelPath);
            if (group == null || typeof group !== 'object') {
                setPath(modelPath, {});
                group = valueAt(model, modelPath);
            }
            ensureMarkers(group, childSchema, modelPath);
            schemaNode = childSchema;
            i += m.consumed;
        }

        if (!ok || leaf == null || typeof leaf !== 'object') {
            skipped++;
            console.warn('applyCsvToModel: skipped row for', tagPath, segments);
            continue;
        }

        for (const [field, value] of Object.entries(fields)) {
            if (value === '' || value === null || value === undefined) {
                delete leaf[field];
            } else if (field === 'Record_To_Historian') {
                leaf[field] = value.toLowerCase() === 'true';
            } else if (field === 'Eng_Low' || field === 'Eng_High' || field === 'Deadband') {
                const num = Number(value);
                if (!isNaN(num)) {
                    leaf[field] = num;
                } else {
                    leaf[field] = value.trim();
                }
            } else {
                leaf[field] = value.trim();
            }
        }

        applied++;
    }

    return { applied, skipped, ignored, placeholders };
}

/**
 * Build the CSV header array and related metadata from the driver
 * presentation config.
 *
 * @param {object|null} driverPresentation - The driver presentation object
 *   (i.e. driverInfo.presentation) or null/undefined for defaults.
 * @returns {{headers: string[], hidePathField: boolean, addressLabel: string, pathLabel: string}}
 */
function buildHeaders(driverPresentation) {
    const addressLabel = driverPresentation?.address?.title || 'Device Address';
    const pathLabel = driverPresentation?.path?.title || 'Metric Path';
    const hidePathField = driverPresentation?.path?.hidden === true;

    const headers = [
        'Tag_Path',
        'Sparkplug_Type',
        'Allowed_Sparkplug_Types',
        addressLabel,
    ];

    if (!hidePathField) {
        headers.push(pathLabel);
    }

    headers.push(
        'Value',
        'Eng_Unit',
        'Eng_Low',
        'Eng_High',
        'Deadband',
        'Record_To_Historian',
    );

    return { headers, hidePathField, addressLabel, pathLabel };
}

/**
 * Convert a single metric row into a CSV data array matching the
 * header order.
 *
 * @param {{tagPath: string, metricSchema: object, modelValues: object}} row
 * @param {{headers: string[], hidePathField: boolean, addressLabel: string, pathLabel: string}} headerInfo
 * @returns {string[]}
 */
function metricToRow(row, headerInfo) {
    const { tagPath, metricSchema, modelValues } = row;
    const { hidePathField } = headerInfo;

    // Allowed Sparkplug types from the schema enum, pipe-separated
    const allowedTypesList = metricSchema?.Sparkplug_Type?.enum?.filter(t => t !== '') ?? [];
    const allowedTypes = allowedTypesList.join('|');

    // Default Sparkplug_Type to the first allowed type if not yet set
    const sparkplugType = modelValues.Sparkplug_Type || allowedTypesList[0] || '';

    const cells = [
        tagPath,
        sparkplugType,
        allowedTypes,
        modelValues.Address ?? '',
    ];

    if (!hidePathField) {
        cells.push(modelValues.Path ?? '');
    }

    cells.push(
        modelValues.Value ?? '',
        modelValues.Eng_Unit ?? '',
        modelValues.Eng_Low ?? '',
        modelValues.Eng_High ?? '',
        modelValues.Deadband ?? '',
        modelValues.Record_To_Historian ?? '',
    );

    return cells;
}

/**
 * Build the help / description rows that appear after the --- delimiter.
 *
 * @param {{headers: string[], hidePathField: boolean, addressLabel: string, pathLabel: string}} headerInfo
 * @param {object|null} driverPresentation
 * @returns {string[][]}
 */
function buildHelpRows(headerInfo, driverPresentation) {
    const { headers, hidePathField } = headerInfo;

    // Separator row: first cell is "---", rest are empty
    const separatorRow = ['---', ...Array(headers.length - 1).fill('')];

    // Build description map
    const descriptions = {
        'Tag_Path': 'Hierarchical path to the metric in the schema tree, using / as separator.',
        'Sparkplug_Type': 'The Sparkplug B data type for this metric.',
        'Allowed_Sparkplug_Types': 'Pipe-separated list of valid Sparkplug types for this metric (informational only, not used on import).',
        'Value': 'Static value for the metric (used instead of Address/Path when the metric has a fixed value).',
        'Eng_Unit': 'Engineering unit label (e.g. kWh, RPM, degC).',
        'Eng_Low': 'Low engineering limit.',
        'Eng_High': 'High engineering limit.',
        'Deadband': 'Change threshold before a new value is reported.',
        'Record_To_Historian': 'Whether this metric should be recorded to the historian (true/false).',
    };

    // Add driver-specific descriptions for Address and Path
    const addressLabel = driverPresentation?.address?.title || 'Device Address';
    const addressDesc = driverPresentation?.address?.description || 'The address of the metric on the device.';
    descriptions[addressLabel] = addressDesc;

    if (!hidePathField) {
        const pathLabel = driverPresentation?.path?.title || 'Metric Path';
        const pathDesc = driverPresentation?.path?.description || 'The path to the metric within the device protocol.';
        descriptions[pathLabel] = pathDesc;
    }

    // Title row: "Column Descriptions"
    const titleRow = ['Column Descriptions', ...Array(headers.length - 1).fill('')];

    // One row per header with its description
    const descriptionRows = headers.map(header => {
        const row = Array(headers.length).fill('');
        row[0] = header;
        row[1] = descriptions[header] || '';
        return row;
    });

    return [separatorRow, titleRow, ...descriptionRows];
}

/**
 * Generate a CSV string from the origin map model and schema.
 *
 * @param {object} model - The origin map model
 * @param {object} schema - The dereferenced schema (after updateDynamicSchemaObjects)
 * @param {object|null} driverPresentation - Driver presentation config
 *   (i.e. driverInfo.presentation), or null for defaults.
 * @returns {string} CSV content
 */
export function generateCsv(model, schema, driverPresentation, schemaType) {
    const headerInfo = buildHeaders(driverPresentation);
    // Add Schema Type as a column
    headerInfo.headers.push('Schema_Type');
    const metricRows = collectMetricRows(schema, model);

    // Add schemaType to each data row
    const dataRows = metricRows.map(row => {
        const baseRow = metricToRow(row, headerInfo);
        baseRow.push(schemaType || '');
        return baseRow;
    });
    const helpRows = buildHelpRows(headerInfo, driverPresentation);

    // Add Schema_Type description to helpRows if present
    if (helpRows.length > 2 && headerInfo.headers.includes('Schema_Type')) {
        // Insert description for Schema_Type
        const descRow = helpRows.find(r => r[0] === 'Schema_Type');
        if (!descRow) {
            // Insert after last known description
            helpRows.push(Array(headerInfo.headers.length).fill(''));
            helpRows[helpRows.length-1][0] = 'Schema_Type';
            helpRows[helpRows.length-1][1] = 'The type of the schema used for this origin map.';
        }
    }

    const allRows = [headerInfo.headers, ...dataRows, ...helpRows];

    return Papa.unparse(allRows);
}

/**
 * Trigger a browser download of a CSV string.
 *
 * @param {string} csvString - The CSV content
 * @param {string} filename - The filename for the download
 */
export function downloadCsv(csvString, filename) {
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Build a reverse mapping from CSV column headers to canonical field names.
 *
 * @param {string[]} headers - The CSV column headers
 * @param {object|null} driverPresentation - Driver presentation config
 * @returns {Object<string, string>} Map from CSV column name to canonical field name
 */
function buildHeaderMap(headers, driverPresentation) {
    const addressLabel = driverPresentation?.address?.title || 'Device Address';
    const pathLabel = driverPresentation?.path?.title || 'Metric Path';

    const map = {};

    for (const header of headers) {
        if (header === addressLabel) {
            map[header] = 'Address';
        } else if (header === pathLabel) {
            map[header] = 'Path';
        } else {
            map[header] = header;
        }
    }

    return map;
}

/**
 * Parse a CSV string and return structured rows with canonical field names.
 *
 * @param {string} csvString - The CSV content to parse
 * @param {object|null} driverPresentation - Driver presentation config
 *   (i.e. driverInfo.presentation), or null for defaults.
 * @returns {{ rows: Array<{ tagPath: string, fields: Object }> }}
 */
export function parseCsv(csvString, driverPresentation) {
    const parsed = Papa.parse(csvString, { header: true, skipEmptyLines: true });
    const headerMap = buildHeaderMap(parsed.meta.fields || [], driverPresentation);

    const rows = [];

    for (const row of parsed.data) {
        // Check if the first value starts with "---" (delimiter for help section)
        const firstValue = Object.values(row)[0];
        if (typeof firstValue === 'string' && firstValue.startsWith('---')) {
            break;
        }

        const tagPath = row['Tag_Path'];
        if (!tagPath || tagPath.trim() === '') {
            continue;
        }

        const fields = {};
        for (const [csvCol, value] of Object.entries(row)) {
            const canonicalName = headerMap[csvCol] || csvCol;

            // Skip non-writable fields
            if (canonicalName === 'Tag_Path' || canonicalName === 'Allowed_Sparkplug_Types') {
                continue;
            }

            fields[canonicalName] = value;
        }

        rows.push({ tagPath, fields });
    }

    return { rows };
}

