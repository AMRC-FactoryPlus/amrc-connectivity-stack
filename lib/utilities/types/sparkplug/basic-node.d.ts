import {IClientOptions, MqttClient} from "mqtt/types/lib/client";

import type { Address } from "./util";

export interface Will {
    topic:          string,
    payload:        Buffer | string,
    qos:            number,
    retain:         boolean,
}

export interface SPSettings extends IClientOptions {
    address:        Address,
    publishDeath:   boolean,
    mqttFactory?:   (w: Will) => Promise<MqttClient>,
}

declare class BasicSparkplugNode {
    constructor (opts: SPSettings);
    will (): Will;
    connect (mqtt?: MqttClient): void;

    /* All these methods may modify the payload parameter, to any depth.
     */

    publishNodeBirth (payload: any, opts?: object): void;
    publishDeviceBirth (device: string, payload: any, opts?: object): void;
    publishNodeData (payload: any, opts?: object): void;
    publishDeviceData (device: string, payload: any, opts?: object): void;
    publishDeviceDeath (device: string, payload: any, opts?: object): void;
    stop (): void;
}
