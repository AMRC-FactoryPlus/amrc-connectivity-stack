/*
 * AMRC Kafka UNS Historian
 * Copyright "2024" AMRC
 */
import {ServiceClient} from "@amrc-factoryplus/service-client";
import {logger} from "./Utils/logger.js";
import mqtt from "mqtt";
import producer from './kafkaproducer.js'
import {UnsTopic} from "./Utils/UnsTopic.js";

let dotenv: any = null;
try {
    dotenv = await import ('dotenv')
} catch (e) {
}

dotenv?.config()

const batchSize: number = Number.parseInt(process.env.BATCH_SIZE);
if (!batchSize) {
    throw new Error("BATCH_SIZE environment variable is not set");
}

const flushInterval: number = Number.parseInt(process.env.FLUSH_INTERVAL);
if (!flushInterval) {
    throw new Error("FLUSH_INTERVAL environment variable is not set");
}

export default class KafkaClient {
    private sparkplugBroker: any;
    private kafkaBatch: any[] = [];
    private serviceClient: ServiceClient;
    private interval: any;
    private pointCounter: number;

    constructor({e}: MQTTClientConstructorParams) {
        this.serviceClient = e.serviceClient;
        this.pointCounter = 0;
    }

    async init() {
        process.on('exit', async () => {
            await this.flushBuffer('EXIT');
            await producer.disconnect();
        });
        await producer.connect();
        this.resetInterval();
        return this;
    }

    private resetInterval() {
        clearInterval(this.interval);
        this.interval = setInterval(() => {
            this.flushBuffer(`${flushInterval}ms INTERVAL`);
        },flushInterval);
    }

    /**
     * Adds a message (or point) to the Kafka batch.
     * Also increments the point counter.
     */
    public addMessage(message: any) {
        this.kafkaBatch.push(message);
        this.pointCounter++;
        // Log the addition
        logger.debug(`Added message to batch, current point count: ${this.pointCounter}`);
        // If the batch is full, flush it
        if (this.kafkaBatch.length >= Number.parseInt(process.env.BATCH_SIZE || "0")) {
            this.flushBuffer(`${process.env.BATCH_SIZE} message BATCH`);
        }
    }

    /**
     * Flushes the current batch.
     * After the simulated flush, we send the Kafka batch (if any) and then reset the flush timer.
     * @param source A label indicating why the flush was triggered.
     */
    private async flushBuffer(source: string) {
        const flushedPoints = this.pointCounter;
        this.pointCounter = 0;
        // Simulate an asynchronous flush operation (replacing writeApi.flush())
        await Promise.resolve();
        logger.info(`🚀 Flushed ${flushedPoints} points [${source}]`);

        if (this.kafkaBatch.length > 0) {
            await producer.sendBatch(this.kafkaBatch);
            this.kafkaBatch = []; // Clear the batch after sending
        }
        this.resetInterval();
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
            logger.error(`⁉ Can't find custom properties for topic ${topicString}! Not writing to Kafka.`);
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

        // write metrics to kafka
        this.writeMetrics(metricPayload, topicString, customProperties);
        return;
    }

    /**
     * Writes all metrics in a UNS MQTT payload to Kafka
     * @param payload The payload from the MQTT packet.
     * @param topic The topic the payload was received on.
     * @param customProperties The custom properties from the MQTTv5 payload.
     */
    private writeMetrics(payload: MetricPayload, topic: string, customProperties: UnsMetricCustomProperties) {
        const unsTopic = new UnsTopic(topic, customProperties);
        let metricTimestamp: Date
        if (payload.timestamp) {
            metricTimestamp = new Date(payload.timestamp);
        } else {
            // No timestamp can be found on the metric or the payload, just use the current time instead.
            metricTimestamp = new Date();
        }

        this.writeToKafka(unsTopic, payload.value, metricTimestamp, customProperties.Unit, customProperties.Type);


        // Handle the batched metrics
        payload.batch?.forEach((metric) => {
            let metricTimestamp: Date
            if (metric.timestamp) {
                metricTimestamp = new Date(metric.timestamp);
            } else if (payload.timestamp) {
                // Metrics might not have a timestamp so use the packet timestamp if we have it.
                metricTimestamp = new Date(payload.timestamp);
            } else {
                // No timestamp can be found on the metric or the payload, just use the current time instead.
                metricTimestamp = new Date();
            }
            // Send each metric to Kafka
            this.writeToKafka(unsTopic, metric.value, metricTimestamp, customProperties.Unit, customProperties.Type);
        });
    }

    /**
     * Writes metric values to Kafka using the metric timestamp.
     * @param topic Topic the metric was published on.
     * @param value Metric value to write to kafka.
     * @param timestamp Timestamp from the metric to write to kafka.
     * @param unit The metric unit from the MQTTv5 custom properties.
     * @param type The Metric type from the MQTTv5 custom properties.
     */
    writeToKafka(topic: UnsTopic, value: string, timestamp: Date, unit: string, type: string) {
        if (value === null) {
            return;
        }

        this.pointCounter++;

        this.kafkaBatch.push({
            measurement: `${topic.GetMetricName()}`,
            type: type,
            value: value,
            timestamp: timestamp.toISOString(),
            tags: {
                metricName: topic.GetMetricName(),
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
            }
        });

        logger.debug(`Added to write buffer (${this.pointCounter}/${batchSize}): [${type}] ${topic.GetMetricPath()} = ${value}`);

        if (this.pointCounter>= batchSize) {
            this.flushBuffer(`${batchSize} point BATCH`);
        }
    }
}