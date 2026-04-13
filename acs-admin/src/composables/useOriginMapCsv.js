/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import Papa from 'papaparse';

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
        } else if (type === 'schemaArray') {
            // For schema arrays, iterate only over model instances
            // (keys that aren't reserved). Each instance's schema was
            // injected into prop.properties by updateDynamicSchemaObjects.
            const modelNode = model?.[key];
            if (modelNode && typeof modelNode === 'object') {
                const instanceKeys = Object.keys(modelNode).filter(
                    k => !RESERVED_KEYS.includes(k),
                );
                for (const instanceKey of instanceKeys) {
                    const instanceSchema = prop.properties?.[instanceKey];
                    if (instanceSchema) {
                        rows.push(
                            ...collectMetricRows(
                                instanceSchema,
                                modelNode[instanceKey],
                                [...currentPath, instanceKey],
                            ),
                        );
                    }
                }
            }
        }
    }

    return rows;
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

/**
 * Apply parsed CSV rows to the origin map model in place.
 *
 * @param {Array<{ tagPath: string, fields: Object }>} rows - Parsed CSV rows
 * @param {object} model - The origin map model to update in place
 * @returns {{ applied: number, skipped: number }}
 */
export function applyCsvToModel(rows, model) {
    let applied = 0;
    let skipped = 0;
    //console.log("model before update:", JSON.stringify(model, null, 2));

    for (const { tagPath, fields } of rows) {
        const segments = tagPath.split('/');
        let current = model;
        let found = true;

        //If an option in the config map is not selected, then it is not added to the model and thus will not be found when applying the CSV.
        for (const segment of segments) {
            if (current == null || typeof current !== 'object' /*|| !(segment in current)*/) {
                found = false;
                break;
            }
            current = current[segment];
        }

        if (!found || current == null || typeof current !== 'object') {
            skipped++;
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
    //console.log("model after update:", JSON.stringify(model, null, 2));

    return { applied, skipped };
}
