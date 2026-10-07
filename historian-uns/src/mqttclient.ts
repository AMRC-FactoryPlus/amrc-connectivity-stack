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
import {
    ConnectionWatchdog, StallWatchdog, describeConnectionChange,
    describeConnectionTimeout, parseConnectTimeout, parseStallTimeout,
    subscriptionOutcome,
} from "./Utils/watchdog.js";

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

/* Exit if no UNS message arrives for this long. See
 * src/Utils/watchdog.ts. */
const stallTimeoutMs: number = parseStallTimeout(process.env.STALL_TIMEOUT);

/* Exit if the MQTT client is not connected with a granted
 * subscription for this long, whatever the traffic. See
 * src/Utils/watchdog.ts. */
const connectTimeoutMs: number = parseConnectTimeout(process.env.CONNECT_TIMEOUT);

let i = 0;

/* Log, then exit non-zero so Kubernetes restarts the pod. This is for
 * states the process cannot recover from by itself. The short delay
 * gives the log line a chance to reach stdout. */
function fatal (msg: string, ...args: any[]): void {
    logger.fatal(msg, ...args);
    setTimeout(() => process.exit(1), 500);
}

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
    private watchdog: StallWatchdog;
    private connWatchdog: ConnectionWatchdog;

    constructor({e}: MQTTClientConstructorParams) {
        this.serviceClient = e.serviceClient;
        this.watchdog = new StallWatchdog({
            timeoutMs: stallTimeoutMs,
            onArm: () => logger.info(`⏱️ Stall watchdog armed: first UNS message received; exit if none for ${stallTimeoutMs / 1000}s`),
            onStall: idle => fatal(
                `🚨 No UNS messages received for ${Math.round(idle / 1000)}s ` +
                `(STALL_TIMEOUT ${stallTimeoutMs / 1000}s). The MQTT connection ` +
                `or subscription is not working, or the UNS ingester is not ` +
                `publishing. Exiting so the pod is restarted.`),
        });
        this.connWatchdog = new ConnectionWatchdog({
            timeoutMs: connectTimeoutMs,
            onChange: (state, prev, unhealthyMs) => {
                const msg = describeConnectionChange(state, prev, unhealthyMs, connectTimeoutMs);
                if (state === "disconnected") logger.warn(`🔗 ${msg}`);
                else logger.info(`🔗 ${msg}`);
            },
            onTimeout: (state, unhealthyMs) =>
                fatal(`🚨 ${describeConnectionTimeout(state, unhealthyMs, connectTimeoutMs)}`),
        });
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
            if (bufferSize === 0 && this.watchdog.enabled) {
                /* Say how long we have been idle, so a stalled
                 * historian is visible in the log before the
                 * watchdog fires. */
                logger.info(this.watchdog.armed
                    ? `🚀 Flushed 0 points to InfluxDB [${source}]; last UNS message ${Math.round(this.watchdog.idleMs() / 1000)}s ago`
                    : `🚀 Flushed 0 points to InfluxDB [${source}]; no UNS message received yet`);
            } else {
                logger.info(`🚀 Flushed ${bufferSize} points to InfluxDB [${source}]`);
            }
            // Reset the interval
            this.resetInterval();
        }).catch(err => {
            /* With maxRetries 0 the points in this batch are gone.
             * This used to be an unhandled rejection, which also
             * killed the process; make the exit explicit. */
            fatal("🚨 Write of %d points to InfluxDB failed: %o", bufferSize, err);
        });
    }

    async run() {
        /* Start the connection watchdog before we ask for a client:
         * finding the broker and getting Kerberos credentials can
         * hang too. */
        if (this.connWatchdog.enabled)
            logger.info(`⏱️ Connection watchdog: exits if not connected to the broker with a granted subscription for ${connectTimeoutMs / 1000}s`);
        else
            logger.warn("⏱️ Connection watchdog disabled (CONNECT_TIMEOUT=0)");
        this.connWatchdog.start();

        this.sparkplugBroker = await this.serviceClient.mqtt_client({
            /* We subscribe ourselves on every connect and check the
             * SUBACK each time. MQTT.js's own resubscribe sends the
             * SUBSCRIBE with no callback, so a refusal on reconnect
             * would go unseen, and it makes our explicit subscribe a
             * no-op answered with (null, []). */
            resubscribe: false,
        });

        this.sparkplugBroker.on("connect", this.on_connect.bind(this));
        this.sparkplugBroker.on("error", this.on_error.bind(this));
        this.sparkplugBroker.on("message", this.on_message.bind(this));
        this.sparkplugBroker.on("close", this.on_close.bind(this));
        this.sparkplugBroker.on("reconnect", this.on_reconnect.bind(this));
        this.sparkplugBroker.on("offline", this.on_offline.bind(this));
        /* Any of these means we have no working connection. Failed
         * reconnect attempts repeat them; the watchdog ignores the
         * repeats. "end" means the client will never reconnect. */
        for (const ev of ["close", "offline", "end"])
            this.sparkplugBroker.on(ev, () => this.connWatchdog.disconnected());

        /* Once armed by the first message, the watchdog covers every
         * way of data stopping: failing to reconnect, and being
         * connected with no working subscription. It does not arm on
         * a site with no traffic at all, so quiet sites don't
         * restart. */
        if (this.watchdog.enabled)
            logger.info(`⏱️ Stall watchdog: arms on the first UNS message, then exits if none arrives for ${stallTimeoutMs / 1000}s`);
        else
            logger.warn("⏱️ Stall watchdog disabled (STALL_TIMEOUT=0)");
        this.watchdog.start();

        logger.info("Connecting to UNS broker...");
    }

    on_connect() {
        logger.info("🔌 Connected to Factory+ broker");
        logger.info("👂 Subscribing to entire UNS namespace");
        /* With resubscribe off nothing else subscribes for us. If
         * the connection has already dropped again (a GSSAPI client
         * reports a connection asynchronously, after checking the
         * server), skip: MQTT.js would queue the SUBSCRIBE and send it
         * on the next connect, on top of the one we send then. */
        if (!this.sparkplugBroker.connected) {
            logger.warn("⚠️ Connection closed before subscribing; will subscribe on the next connect");
            return;
        }
        /* The SUBACK must match this connection. */
        const session = this.connWatchdog.connected();
        this.sparkplugBroker.subscribe("UNS/v1/#", (err, granted) => {
            /* A refused subscription (e.g. 0x87 Not authorized) leaves
             * us connected but receiving nothing. The broker fixes
             * the ACL at connect time, so retrying on this connection
             * will not help. Exit and start again. */
            const outcome = subscriptionOutcome(err, granted);
            if (outcome.status === "refused") {
                fatal("🚨 Broker refused the UNS subscription: %s", outcome.detail);
                return;
            }
            if (outcome.status === "unconfirmed") {
                /* e.g. the connection closed before the SUBACK. We
                 * subscribe again on the next connect. If no
                 * subscription is granted within CONNECT_TIMEOUT, the
                 * connection watchdog exits. */
                logger.warn("⚠️ UNS subscription not confirmed: %s", outcome.detail);
                return;
            }
            this.connWatchdog.subscribed(session);
            logger.info("✅ Subscribed to entire UNS namespace");
        });
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

    on_offline() {
        logger.warn(`📴 MQTT client offline`);
    }

    on_error(error: any) {
        logger.error("🚨 MQTT error: %o", error);
        // Flush any remaining data
        this.flushBuffer('MQTT_ERROR');
    }

    async on_message(topicString: string, payload: Buffer, packet: mqtt.IPublishPacket) {
        /* Any message on the subscription counts, even one we cannot
         * use: it proves the connection and subscription work. */
        this.watchdog.touch();

        const messageString = payload.toString();
        if (!packet.properties?.userProperties) {
            logger.error(`⁉ Can't find custom properties for topic ${topicString}! Not writing to Influx.`);
            return
        }

        const customProperties =
            packet.properties.userProperties as unknown as UnsMetricCustomProperties;

        /* A malformed message used to throw out of this async handler
         * as an unhandled rejection and end the process, so one bad
         * publisher could crash-loop the historian. Skip it instead. */
        let metricPayload: MetricPayload;
        try {
            metricPayload = JSON.parse(messageString);
        } catch (e) {
            logger.error(`🚨 Bad JSON payload on topic ${topicString}: ${e}`);
            return;
        }
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

        /* Simulated-data markers forwarded by the UNS ingester as
         * MQTT user properties become Influx tags, so replayed data
         * is recognisable and removable by run. */
        const simTags: Record<string, string> = customProperties.Simulated === "true"
            ? {
                simulated: "true",
                ...(customProperties.RunId
                    ? { run_id: String(customProperties.RunId) } : {}),
            }
            : {};
        this.writeToInfluxDB(unsTopic, payload.value, payloadTimestamp, customProperties.Unit, customProperties.Type, simTags);

        // Handle the batched metrics
        payload.batch?.forEach((metric) => {
            const metricTimestamp: bigint = metric.timestamp
                ? this.parse_iso_ns(metric.timestamp)
                : payloadTimestamp;
            // Send each metric to InfluxDB
            this.writeToInfluxDB(unsTopic, metric.value, metricTimestamp, customProperties.Unit, customProperties.Type, simTags);
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
    writeToInfluxDB(topic: UnsTopic, value: any, timestamp: bigint, unit: string, type: string, extraTags: Record<string, string> = {}) {
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
            unit: unit,
            ...extraTags,
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
