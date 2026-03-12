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
            // Only include metrics that exist in the model
            const modelValue = model?.[key];
            if (modelValue && typeof modelValue === 'object') {
                // Merge allOf[0].properties and allOf[1].properties to get the
                // full metric schema (types, defaults, descriptions, etc.)
                const metricSchema = {
                    ...prop.allOf[0]?.properties,
                    ...prop.allOf[1]?.properties,
                };
                rows.push({
                    tagPath: currentPath.join('/'),
                    metricSchema,
                    modelValues: modelValue,
                });
            }
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
    const allowedTypes = metricSchema?.Sparkplug_Type?.enum?.filter(t => t !== '').join('|') ?? '';

    const cells = [
        tagPath,
        modelValues.Sparkplug_Type ?? '',
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
export function generateCsv(model, schema, driverPresentation) {
    const headerInfo = buildHeaders(driverPresentation);
    const metricRows = collectMetricRows(schema, model);

    const dataRows = metricRows.map(row => metricToRow(row, headerInfo));
    const helpRows = buildHelpRows(headerInfo, driverPresentation);

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
