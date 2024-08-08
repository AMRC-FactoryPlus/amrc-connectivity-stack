/**
 * UNS payload body
 */
interface MetricPayload {
    timestamp: string,
    value: string
    batch?: MetricPayload[]
}

/**
 * MQTTV5 custom properties
 */
interface UnsMetricCustomProperties {
    InstanceUUID: string,
    SchemaUUID: string,
    Transient: boolean,
    Unit: string,
    Type: string,
    InstanceUUIDPath: string,
    SchemaUUIDPath: string
}

/**
 * ISA95 information for a device
 */
interface ISA95Schema {
    Enterprise?: string,
    Site?: string,
    Area?: string,
    WorkCenter?: string,
    WorkUnit?: string
}