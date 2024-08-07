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
    Instance_UUID: string,
    Schema_UUID: string,
    Transient: boolean,
    Unit: string,
    Type: string
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