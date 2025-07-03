/*
 * Factory+ / AMRC Connectivity Stack (ACS) OPC UA Server component
 * InfluxDB client for data retrieval
 * Copyright 2025 AMRC
 */

import { InfluxDB, Point } from "@influxdata/influxdb-client";

export class InfluxClient {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.log = this.fplus.debug.bound("influx-client");
        
        this.url = process.env.INFLUX_URL || "http://localhost:8086";
        this.token = process.env.INFLUX_TOKEN;
        this.org = process.env.INFLUX_ORG || "default";
        this.bucket = process.env.INFLUX_BUCKET || "uns";
        
        this.client = null;
        this.queryApi = null;
        this.cache = new Map(); // Simple cache for recent values
        this.cacheTimeout = 5000; // 5 seconds cache timeout
    }

    async init() {
        this.log("Initializing InfluxDB client...");
        
        if (!this.token) {
            throw new Error("INFLUX_TOKEN environment variable is required");
        }
        
        this.client = new InfluxDB({
            url: this.url,
            token: this.token
        });
        
        this.queryApi = this.client.getQueryApi(this.org);
        
        this.log(`Connected to InfluxDB at ${this.url}`);
    }

    async close() {
        if (this.client) {
            this.client.close();
        }
    }

    /**
     * Get the current (most recent) value for a metric path
     * @param {string} path - The metric path in format: group/node/device/path/measurement
     * @returns {Promise<any>} The current value
     */
    async getCurrentValue(path) {
        const cacheKey = `current:${path}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return cached.value;
        }

        try {
            const pathParts = this.parsePath(path);
            const measurementPatterns = this.getMeasurementPatterns(pathParts.measurement);

            // Try each measurement pattern until we find data
            let result = [];
            for (const measurement of measurementPatterns) {
                const query = `
                    from(bucket: "${this.bucket}")
                    |> range(start: -1h)
                    |> filter(fn: (r) => r._measurement == "${measurement}")
                    |> filter(fn: (r) => r.group == "${pathParts.group}")
                    |> filter(fn: (r) => r.node == "${pathParts.node}")
                    |> filter(fn: (r) => r.device == "${pathParts.device}")
                    |> filter(fn: (r) => r.path == "${pathParts.path}")
                    |> filter(fn: (r) => r._field == "value")
                    |> last()
                `;

                result = await this.executeQuery(query);
                if (result.length > 0) {
                    break; // Found data, stop trying other patterns
                }
            }

            const value = result.length > 0 ? result[0]._value : null;
            
            // Cache the result
            this.cache.set(cacheKey, {
                value: value,
                timestamp: Date.now()
            });
            
            return value;
        } catch (error) {
            this.log(`Error getting current value for ${path}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get the current value with timestamp for a metric path
     * @param {string} path - The metric path
     * @returns {Promise<{value: any, timestamp: Date}>} The value and timestamp
     */
    async getTimestampedValue(path) {
        try {
            const pathParts = this.parsePath(path);
            const measurementPatterns = this.getMeasurementPatterns(pathParts.measurement);

            // Try each measurement pattern until we find data
            let result = [];
            for (const measurement of measurementPatterns) {
                const query = `
                    from(bucket: "${this.bucket}")
                    |> range(start: -1h)
                    |> filter(fn: (r) => r._measurement == "${measurement}")
                    |> filter(fn: (r) => r.group == "${pathParts.group}")
                    |> filter(fn: (r) => r.node == "${pathParts.node}")
                    |> filter(fn: (r) => r.device == "${pathParts.device}")
                    |> filter(fn: (r) => r.path == "${pathParts.path}")
                    |> filter(fn: (r) => r._field == "value")
                    |> last()
                `;

                result = await this.executeQuery(query);
                if (result.length > 0) {
                    break; // Found data, stop trying other patterns
                }
            }
            
            if (result.length > 0) {
                return {
                    value: result[0]._value,
                    timestamp: new Date(result[0]._time)
                };
            }
            
            return { value: null, timestamp: new Date() };
        } catch (error) {
            this.log(`Error getting timestamped value for ${path}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get all available groups from InfluxDB
     * @returns {Promise<string[]>} Array of group names
     */
    async getGroups() {
        const cacheKey = "groups";
        const cached = this.cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout * 6) { // Longer cache for structure
            return cached.value;
        }

        try {
            const query = `
                from(bucket: "${this.bucket}")
                |> range(start: -24h)
                |> group(columns: ["group"])
                |> distinct(column: "group")
                |> keep(columns: ["group"])
            `;

            const result = await this.executeQuery(query);
            const groups = result.map(r => r.group).filter(g => g);
            
            this.cache.set(cacheKey, {
                value: groups,
                timestamp: Date.now()
            });
            
            return groups;
        } catch (error) {
            this.log(`Error getting groups: ${error.message}`);
            return [];
        }
    }

    /**
     * Get all nodes for a specific group
     * @param {string} group - The group name
     * @returns {Promise<string[]>} Array of node names
     */
    async getNodes(group) {
        const cacheKey = `nodes:${group}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout * 6) {
            return cached.value;
        }

        try {
            const query = `
                from(bucket: "${this.bucket}")
                |> range(start: -24h)
                |> filter(fn: (r) => r.group == "${group}")
                |> group(columns: ["node"])
                |> distinct(column: "node")
                |> keep(columns: ["node"])
            `;

            const result = await this.executeQuery(query);
            const nodes = result.map(r => r.node).filter(n => n);
            
            this.cache.set(cacheKey, {
                value: nodes,
                timestamp: Date.now()
            });
            
            return nodes;
        } catch (error) {
            this.log(`Error getting nodes for group ${group}: ${error.message}`);
            return [];
        }
    }

    /**
     * Get all devices for a specific group/node
     * @param {string} group - The group name
     * @param {string} node - The node name
     * @returns {Promise<string[]>} Array of device names
     */
    async getDevices(group, node) {
        const cacheKey = `devices:${group}:${node}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout * 6) {
            return cached.value;
        }

        try {
            const query = `
                from(bucket: "${this.bucket}")
                |> range(start: -24h)
                |> filter(fn: (r) => r.group == "${group}")
                |> filter(fn: (r) => r.node == "${node}")
                |> group(columns: ["device"])
                |> distinct(column: "device")
                |> keep(columns: ["device"])
            `;

            const result = await this.executeQuery(query);
            const devices = result.map(r => r.device).filter(d => d);
            
            this.cache.set(cacheKey, {
                value: devices,
                timestamp: Date.now()
            });
            
            return devices;
        } catch (error) {
            this.log(`Error getting devices for ${group}/${node}: ${error.message}`);
            return [];
        }
    }

    /**
     * Get all paths for a specific group/node/device
     * @param {string} group - The group name
     * @param {string} node - The node name
     * @param {string} device - The device name
     * @returns {Promise<string[]>} Array of path names
     */
    async getPaths(group, node, device) {
        const cacheKey = `paths:${group}:${node}:${device}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout * 6) {
            return cached.value;
        }

        try {
            const query = `
                from(bucket: "${this.bucket}")
                |> range(start: -24h)
                |> filter(fn: (r) => r.group == "${group}")
                |> filter(fn: (r) => r.node == "${node}")
                |> filter(fn: (r) => r.device == "${device}")
                |> group(columns: ["path"])
                |> distinct(column: "path")
                |> keep(columns: ["path"])
            `;

            const result = await this.executeQuery(query);
            const paths = result.map(r => r.path).filter(p => p);
            
            this.cache.set(cacheKey, {
                value: paths,
                timestamp: Date.now()
            });
            
            return paths;
        } catch (error) {
            this.log(`Error getting paths for ${group}/${node}/${device}: ${error.message}`);
            return [];
        }
    }

    /**
     * Get all measurements for a specific group/node/device/path
     * @param {string} group - The group name
     * @param {string} node - The node name
     * @param {string} device - The device name
     * @param {string} path - The path name
     * @returns {Promise<string[]>} Array of measurement names
     */
    async getMeasurements(group, node, device, path) {
        const cacheKey = `measurements:${group}:${node}:${device}:${path}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout * 6) {
            return cached.value;
        }

        try {
            const query = `
                from(bucket: "${this.bucket}")
                |> range(start: -24h)
                |> filter(fn: (r) => r.group == "${group}")
                |> filter(fn: (r) => r.node == "${node}")
                |> filter(fn: (r) => r.device == "${device}")
                |> filter(fn: (r) => r.path == "${path}")
                |> group(columns: ["_measurement"])
                |> distinct(column: "_measurement")
                |> keep(columns: ["_measurement"])
            `;

            const result = await this.executeQuery(query);
            const measurements = result.map(r => this.getMetricNameFromMeasurement(r._measurement)).filter(m => m);
            
            this.cache.set(cacheKey, {
                value: measurements,
                timestamp: Date.now()
            });
            
            return measurements;
        } catch (error) {
            this.log(`Error getting measurements for ${group}/${node}/${device}/${path}: ${error.message}`);
            return [];
        }
    }

    /**
     * Execute a Flux query and return results
     * @param {string} query - The Flux query
     * @returns {Promise<Array>} Query results
     */
    async executeQuery(query) {
        const results = [];
        
        return new Promise((resolve, reject) => {
            this.queryApi.queryRows(query, {
                next: (row, tableMeta) => {
                    const record = tableMeta.toObject(row);
                    results.push(record);
                },
                error: (error) => {
                    this.log(`Query error: ${error.message}`);
                    reject(error);
                },
                complete: () => {
                    resolve(results);
                }
            });
        });
    }

    /**
     * Parse a path string into components
     * @param {string} path - Path in format: group/node/device/path/measurement
     * @returns {Object} Parsed path components
     */
    parsePath(path) {
        const parts = path.split("/");
        if (parts.length < 5) {
            throw new Error(`Invalid path format: ${path}. Expected: group/node/device/path/measurement`);
        }
        
        return {
            group: parts[0],
            node: parts[1],
            device: parts[2],
            path: parts.slice(3, -1).join("/"), // Handle nested paths
            measurement: parts[parts.length - 1]
        };
    }

    /**
     * Convert metric name to InfluxDB measurement name patterns
     * @param {string} metricName - The metric name
     * @returns {string[]} Array of possible InfluxDB measurement names
     */
    getMeasurementPatterns(metricName) {
        // Based on the historian patterns, measurements are suffixed with type indicators
        const suffixes = [":i", ":u", ":d", ":b", ":s"];
        const patterns = [metricName]; // Include the base name

        // Add all possible suffixed versions
        for (const suffix of suffixes) {
            patterns.push(metricName + suffix);
        }

        return patterns;
    }

    /**
     * Extract metric name from InfluxDB measurement name
     * @param {string} measurement - The InfluxDB measurement name
     * @returns {string} Metric name
     */
    getMetricNameFromMeasurement(measurement) {
        // Remove type suffixes to get the original metric name
        const suffixes = [":i", ":u", ":d", ":b", ":s"];
        
        for (const suffix of suffixes) {
            if (measurement.endsWith(suffix)) {
                return measurement.slice(0, -suffix.length);
            }
        }
        
        return measurement;
    }
}
