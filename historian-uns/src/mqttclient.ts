/*
 * AMRC InfluxDB UNS Historian
 * Copyright "2024" AMRC
 */
import {ServiceClient} from "@amrc-factoryplus/service-client";
import {logger} from "./Utils/logger.js";
import {InfluxDB, Point} from '@influxdata/influxdb-client'
import {Agent} from 'http'
import mqtt from "mqtt";
import {UnsTopic} from "./Utils/UnsTopic.js";

let dotenv: any = null;
try {
    dotenv = await import ('dotenv')
} catch (e) {
}

dotenv?.config()

const influxURL: string = process.env.INFLUX_URL;
if (!influxURL) {
    throw new Error("INFLUX_URL environment variable is not set");
}

const influxToken: string = process.env.INFLUX_TOKEN
if (!influxToken) {
    throw new Error("INFLUX_TOKEN environment variable is not set");
}

const influxOrganisation: string = process.env.INFLUX_ORG
if (!influxOrganisation) {
    throw new Error("INFLUX_ORG environment variable is not set");
}

const batchSize: number = Number.parseInt(process.env.BATCH_SIZE);
if (!batchSize) {
    throw new Error("BATCH_SIZE environment variable is not set");
}

const flushInterval: number = Number.parseInt(process.env.FLUSH_INTERVAL);
if (!flushInterval) {
    throw new Error("FLUSH_INTERVAL environment variable is not set");
}

let i = 0;

// Node.js HTTP client OOTB does not reuse established TCP connections, a custom node HTTP agent
// can be used to reuse them and thus reduce the count of newly established networking sockets
const keepAliveAgent = new Agent({
    keepAlive: true, // reuse existing connections
    keepAliveMsecs: 20 * 1000, // 20 seconds keep alive
})

const influxDB = new InfluxDB({
    url: influxURL, token: influxToken, transportOptions: {
        agent: keepAliveAgent,
    }
})

let interval: any;

/* points/lines are batched in order to minimize networking and increase performance */

const writeApi = influxDB.getWriteApi(influxOrganisation,
    process.env.INFLUX_BUCKET || 'default',
    'ns',
    {
        /* the maximum points/lines to send in a single batch to InfluxDB server */
        batchSize: batchSize + 1, // don't let automatically flush data
        /* maximum time in millis to keep points in an unflushed batch, 0 means don't periodically flush */
        flushInterval: 0, // Never allow the package to flush: we'll flush manually
        /* maximum size of the retry buffer - it contains items that could not be sent for the first time */
        maxBufferLines: 30_000, /* the count of internally-scheduled retries upon write failure, the delays between write attempts follow an exponential backoff strategy if there is no Retry-After HTTP header */
        maxRetries: 0, // do not retry writes
        // ... there are more write options that can be customized, see
        // https://influxdata.github.io/influxdb-client-js/influxdb-client.writeoptions.html and
        // https://influxdata.github.io/influxdb-client-js/influxdb-client.writeretryoptions.html
    }
);

export default class MQTTClient {
    private sparkplugBroker: any;
    private serviceClient: ServiceClient;

    constructor({e}: MQTTClientConstructorParams) {
        this.serviceClient = e.serviceClient;
    }

    async init() {

        process.on('exit', () => {
            this.flushBuffer('EXIT');
            keepAliveAgent.destroy();
        })

        return this;
    }

    private flushBuffer(source: string) {
        let bufferSize = i;
        i = 0;
        writeApi.flush().then(() => {
            logger.info(`🚀 Flushed ${bufferSize} points to InfluxDB [${source}]`);
            // Reset the interval
            this.resetInterval();
        })
    }

    async run() {
        this.sparkplugBroker = await this.serviceClient.mqtt_client();

        this.sparkplugBroker.on("connect", this.on_connect.bind(this));
        this.sparkplugBroker.on("error", this.on_error.bind(this));
        this.sparkplugBroker.on("message", this.on_message.bind(this));
        this.sparkplugBroker.on("close", this.on_close.bind(this));
        this.sparkplugBroker.on("reconnect", this.on_reconnect.bind(this));
        logger.info("Connecting to UNS broker...");
    }

    on_connect() {
        logger.info("🔌 Connected to Factory+ broker");
        logger.info("👂 Subscribing to entire UNS namespace");
        this.sparkplugBroker.subscribe("UNS/v1/#");
        this.resetInterval();
    }

    private resetInterval() {
        clearInterval(interval);
        interval = setInterval(() => {
            this.flushBuffer(`${flushInterval}ms INTERVAL`);
        }, flushInterval);
    }

    on_close() {
        logger.warn(`❌ Disconnected from Factory+ broker`);

        // Flush any remaining data
        this.flushBuffer('CONN_CLOSE');
    }

    on_reconnect() {
        logger.warn(`⚠️ Reconnecting to Factory+ broker...`);
    }

    on_error(error: any) {
        logger.error("🚨 MQTT error: %o", error);
        // Flush any remaining data
        this.flushBuffer('MQTT_ERROR');
    }

    async on_message(topicString: string, payload: Buffer, packet: mqtt.IPublishPacket) {
        const messageString = payload.toString();
        if (!packet.properties?.userProperties) {
            logger.error(`⁉ Can't find custom properties for topic ${topicString}! Not writing to Influx.`);
            return
        }

        const customProperties =
            packet.properties.userProperties as unknown as UnsMetricCustomProperties;

        const metricPayload: MetricPayload = JSON.parse(messageString);
        logger.info(`🎉 Received ${messageString} from topic ${topicString}`);
        if (!topicString) {
            logger.error(`🚨 Bad topic: ${topicString}`);
            return;
        }

        // write metrics to influx
        this.writeMetrics(metricPayload, topicString, customProperties);
        return;
    }

    /**
     * Parse an ISO 8601 timestamp string to nanoseconds since epoch.
     * Handles both standard millisecond precision ("...56.100Z") and
     * nanosecond precision ("...56.100923659Z") produced by the UNS ingester.
     */
    private parse_iso_ns(iso: string): bigint {
        const match = iso.match(/^(.+)\.(\d+)Z$/);
        if (!match) {
            return BigInt(new Date(iso).getTime()) * 1_000_000n;
        }
        const [, base, frac] = match;
        const secMs = new Date(base + 'Z').getTime();
        // Pad or truncate fractional digits to exactly 9 (nanoseconds within second)
        const fracNs = BigInt(frac.padEnd(9, '0').slice(0, 9));
        return BigInt(secMs / 1000) * 1_000_000_000n + fracNs;
    }

    /**
     * Writes all metrics in a UNS MQTT payload to InfluxDB
     * @param payload The payload from the MQTT packet.
     * @param topic The topic the payload was received on.
     * @param customProperties The custom properties from the MQTTv5 payload.
     */
    private writeMetrics(payload: MetricPayload, topic: string, customProperties: UnsMetricCustomProperties) {
        const unsTopic = new UnsTopic(topic, customProperties);

        const payloadTimestamp: bigint = payload.timestamp
            ? this.parse_iso_ns(payload.timestamp)
            : BigInt(Date.now()) * 1_000_000n;

        this.writeToInfluxDB(unsTopic, payload.value, payloadTimestamp, customProperties.Unit, customProperties.Type);

        // Handle the batched metrics
        payload.batch?.forEach((metric) => {
            const metricTimestamp: bigint = metric.timestamp
                ? this.parse_iso_ns(metric.timestamp)
                : payloadTimestamp;
            // Send each metric to InfluxDB
            this.writeToInfluxDB(unsTopic, metric.value, metricTimestamp, customProperties.Unit, customProperties.Type);
        });
    }

    /**
     * Writes metric values to InfluxDB using the metric timestamp.
     * @param topic Topic the metric was published on.
     * @param value Metric value to write to InfluxDB.
     * @param timestamp Nanoseconds since epoch as a BigInt.
     * @param unit The metric unit from the MQTTv5 custom properties.
     * @param type The Metric type from the MQTTv5 custom properties.
     */
    writeToInfluxDB(topic: UnsTopic, value: string, timestamp: bigint, unit: string, type: string) {
        if (value === null) {
            return;
        }

        // InfluxDB client accepts string timestamps in line protocol format,
        // which handles nanosecond values that exceed Number.MAX_SAFE_INTEGER.
        const influxTimestamp = timestamp.toString();

        writeApi.useDefaultTags({
            topLevelInstance: topic.GetTopLevelInstance(),
            bottomLevelInstance: topic.GetBottomLevelInstance(),
            usesInstances: `${topic.GetTopLevelInstance()}:${topic.GetInstanceFull()}`,
            topLevelSchema: topic.GetTopLevelSchema(),
            bottomLevelSchema: topic.GetBottomLevelSchema(),
            usesSchemas: `${topic.GetTopLevelSchema()}:${topic.GetSchemaFull()}`,
            enterprise: topic.GetISA95Schema().Enterprise ?? "",
            site: topic.GetISA95Schema().Site ?? "",
            area: topic.GetISA95Schema().Area ?? "",
            workCenter: topic.GetISA95Schema().WorkCenter ?? "",
            workUnit: topic.GetISA95Schema().WorkUnit ?? "",
            path: topic.GetMetricPath(),
            unit: unit
        });

        let numVal = null;

        switch (type) {
            case "Int8":
            case "Int16":
            case "Int32":
            case "Int64":
                // Validate
                numVal = Number(value);
                if (!Number.isInteger(numVal)) {
                    logger.warn(`${topic.GetMetricPath()} should be a ${type} but received ${numVal}. Not recording.`);
                    return;
                }
                writeApi.writePoint(
                    new Point(`${topic.GetMetricName()}:i`)
                        .intField('value', numVal)
                        .timestamp(influxTimestamp)
                );
                break;
            case "UInt8":
            case "UInt16":
            case "UInt32":
            case "UInt64":
                // Validate
                numVal = Number(value);
                if (!Number.isInteger(numVal)) {
                    logger.warn(`${topic.GetMetricPath()} should be a ${type} but received ${numVal}. Not recording.`);
                    return;
                }
                writeApi.writePoint(
                    new Point(`${topic.GetMetricName()}:u`)
                        .uintField('value', numVal)
                        .timestamp(influxTimestamp)
                );
                break;
            case "Float":
            case "Double":
                // Validate
                numVal = Number(value);
                if (isNaN(parseFloat(numVal))) {
                    logger.warn(`${topic.GetMetricPath()} should be a ${type} but received ${numVal}. Not recording.`);
                    return;
                }
                writeApi.writePoint(
                    new Point(`${topic.GetMetricName()}:d`)
                        .floatField('value', numVal)
                        .timestamp(influxTimestamp)
                );
                break;
            case "Boolean":
                if (typeof value != "boolean") {
                    logger.warn(`${topic.GetMetricPath()} should be a ${type} but received ${value}. Not recording.`);
                    return;
                }
                writeApi.writePoint(
                    new Point(`${topic.GetMetricName()}:b`)
                        .booleanField('value', value)
                        .timestamp(influxTimestamp));
                break;
            default:
                writeApi.writePoint(
                    new Point(`${topic.GetMetricName()}:s`)
                        .stringField('value', value)
                        .timestamp(influxTimestamp));
                break;

        }

        i++;

        logger.debug(`Added to write buffer (${i}/${batchSize}): [${type}] ${topic.GetMetricPath()} = ${value}`);

        if (i >= batchSize) {
            this.flushBuffer(`${batchSize} point BATCH`);
        }
    }
}
