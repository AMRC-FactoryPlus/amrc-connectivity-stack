import type { MqttClient } from "mqtt";
import type { Address } from "@amrc-factoryplus/utilities";

interface Settings {
    address:        Address,
    publishDeath:   boolean,
}

interface Will {
    topic:          string,
    payload:        Buffer | string,
}

declare class BasicSparkplugNode {
    constructor (opts: Settings);
    will (): Will;
    connect (mqtt: MqttClient): void;

    /* All these methods may modify the payload parameter, to any depth.
     */

    publishNodeBirth (payload: any, opts?: object): void;
    publishDeviceBirth (device: string, payload: any, opts?: object): void;
    publishNodeData (payload: any, opts?: object): void;
    publishDeviceData (device: string, payload: any, opts?: object): void;
    publishDeviceDeath (device: string, payload: any, opts?: object): void;
    stop (): void;
}
