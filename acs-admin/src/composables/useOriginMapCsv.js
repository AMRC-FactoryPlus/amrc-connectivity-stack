/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import Papa from 'papaparse';
// No 'set' export from vue in Vue 3. Use plain assignment; reactivity is handled by the parent component's set helper if needed.

const RESERVED_KEYS = ['Schema_UUID', 'Instance_UUID', 'patternProperties', '$meta', 'required'];

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
function collectMetricRows(schema, model, pathSegments = []) {
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
            rows.push(...collectMetricRows(prop, model?.[key], currentPath));
        } else if (type === 'schemaArray' && prop.patternProperties) {
            // For arrays, walk each instance in the model if present, otherwise just walk the schema
            const regexKey = Object.keys(prop.patternProperties)[0];
            const schemaForArray = prop.patternProperties[regexKey];
            const modelArray = model?.[key] || {};
            // If there are instances in the model, walk them
            for (const instanceKey of Object.keys(modelArray)) {
                rows.push(...collectMetricRows(schemaForArray, modelArray[instanceKey], [...currentPath, instanceKey]));
            }
            // Also add a row for the pattern itself if no instances exist
            if (Object.keys(modelArray).length === 0) {
                rows.push(...collectMetricRows(schemaForArray, undefined, [...currentPath, '<new>']));
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
 */
export function applyCsvToModel(rows, model, schema, setFn) {
    let applied = 0;
    let skipped = 0;

    function getMetricSchema(schema, segments) {
        let currentSchema = schema;
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            if (!currentSchema) {
                console.warn('getMetricSchema: schema is null at segment', segment, segments);
                return null;
            }
            // Handle patternProperties (arrays)
            if (currentSchema.patternProperties) {
                const regexKey = Object.keys(currentSchema.patternProperties)[0];
                currentSchema = currentSchema.patternProperties[regexKey];
                continue;
            }
            if (!currentSchema.properties || !(segment in currentSchema.properties)) {
                console.warn('getMetricSchema: segment not found in properties', segment, segments, currentSchema);
                return null;
            }
            currentSchema = currentSchema.properties[segment];
        }
        // If this is a metric, return the merged allOf properties
        if (currentSchema && currentSchema.allOf) {
            console.debug('getMetricSchema: found metric schema for', segments, currentSchema);
            return {
                ...currentSchema.allOf[0]?.properties,
                ...currentSchema.allOf[1]?.properties,
            };
        }
        console.warn('getMetricSchema: did not find allOf for', segments, currentSchema);
        return null;
    }

    for (const { tagPath, fields } of rows) {
        const segments = tagPath.split('/');
        let current = model;
        let found = true;
        let pathSoFar = [];

        // Traverse or create the path in the model

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            pathSoFar.push(segment);
            if (current == null || typeof current !== 'object') {
                found = false;
                break;
            }
            if (!(segment in current)) {
                // If not at the leaf, create the parent object
                if (i < segments.length - 1) {
                    if (typeof setFn === 'function') {
                        setFn(pathSoFar.join('.'), {}, model, '.');
                    } else {
                        current[segment] = {};
                    }
                    // After creating, update current to point to the new parent object
                    let temp = model;
                    for (let j = 0; j <= i; j++) {
                        temp = temp[segments[j]];
                    }
                    current = temp;
                } else if (i === segments.length - 1 && schema) {
                    // Only create the metric object at the leaf
                    const metricSchema = getMetricSchema(schema, segments);
                    if (metricSchema) {
                        // Create the metric object with default values from schema
                        const newMetric = {};
                        Object.keys(metricSchema).forEach(key => {
                            if ('default' in metricSchema[key]) {
                                newMetric[key] = metricSchema[key].default;
                            } else if ('enum' in metricSchema[key]) {
                                newMetric[key] = metricSchema[key].enum[0];
                            }
                        });
                        if (typeof setFn === 'function') {
                            setFn(pathSoFar.join('.'), newMetric, model, '.');
                        } else {
                            current[segment] = newMetric;
                        }
                        // After creating, update current to point to the new metric object
                        let temp = model;
                        for (let j = 0; j <= i; j++) {
                            temp = temp[segments[j]];
                        }
                        current = temp;
                        console.debug('applyCsvToModel: created metric in model for', tagPath, newMetric);
                    } else {
                        found = false;
                        console.warn('applyCsvToModel: could not find metric schema for', tagPath, segments);
                        break;
                    }
                } else {
                    found = false;
                    break;
                }
            } else {
                current = current[segment];
            }
        }

        if (!found || current == null || typeof current !== 'object') {
            skipped++;
            console.warn('applyCsvToModel: skipped row for', tagPath, segments);
            continue;
        }

        for (const [field, value] of Object.entries(fields)) {
            if (value === '' || value === null || value === undefined) {
                delete current[field];
            } else if (field === 'Record_To_Historian') {
                current[field] = value.toLowerCase() === 'true';
            } else if (field === 'Eng_Low' || field === 'Eng_High' || field === 'Deadband') {
                const num = Number(value);
                if (!isNaN(num)) {
                    current[field] = num;
                } else {
                    current[field] = value.trim();
                }
            } else {
                current[field] = value.trim();
            }
        }

        applied++;
    }
    // ...existing code...

    return { applied, skipped };
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

