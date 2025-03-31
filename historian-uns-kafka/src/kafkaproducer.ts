/*
 * AMRC Kafka UNS Historian
 * Copyright "2024" AMRC
 */
import { Kafka } from 'kafkajs';

const kafkaBrokerUrl: string = process.env.KAFKA_BROKER_URL ?? "";
if(!kafkaBrokerUrl) {
    throw new Error("KAFKA_BROKER_URL environment variable is not set");
}
const kafkaTopic: string = process.env.KAFKA_TOPIC ?? "";
if(!kafkaTopic) {
    throw new Error("KAFKA_TOPIC environment variable is not set");
}

const kafka = new Kafka({
    clientId: 'mqtt-to-kafka',
    brokers: [kafkaBrokerUrl]
});

const producer = kafka.producer();

export async function connectProducer() {
    await producer.connect();
}

export async function disconnectProducer() {
    await producer.disconnect();
}

export async function sendBatchToKafka(batch: any[]) {
    if (batch.length === 0) return;

    try {
        const messages = batch.map(data => ({
            value: JSON.stringify(data)
        }));

        await producer.send({
            topic: kafkaTopic,
            messages: messages
        });

        console.log(`✅ Sent ${batch.length} messages to Kafka topic "${kafkaTopic}"`);
    } catch (error) {
        console.error("🚨 Error sending batch to Kafka:", error);
    }
}

export default {
    connect: connectProducer,
    disconnect: disconnectProducer,
    sendBatch: sendBatchToKafka
};
