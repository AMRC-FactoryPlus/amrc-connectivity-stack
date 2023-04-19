/*
 * AMRC InfluxDB Sparkplug Ingester
 * Copyright "2023" AMRC
 */

import { ServiceClient, Topic } from "@amrc-factoryplus/utilities";
import { Reader } from "protobufjs";
interface MQTTClientConstructorParams {
    e: {
        serviceClient: ServiceClient;
    };
}
export default class MQTTClient {
    private serviceClient;
    private mqtt;
    private aliasResolver;
    private birthDebounce;
    constructor({ e }: MQTTClientConstructorParams);
    init(): Promise<this>;
    run(): Promise<void>;
    on_connect(): void;
    on_close(): void;
    on_reconnect(): void;
    on_error(error: any): void;
    on_message(topicString: string, message: Uint8Array | Reader): Promise<void>;
    private writeMetrics;
    writeToInfluxDB(birth: any, topic: Topic, value: any): void;
    setNestedValue(obj: any, path: any, value: any): any;
}
export {};
