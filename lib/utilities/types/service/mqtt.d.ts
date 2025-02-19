import {IClientOptions, MqttClient} from "mqtt/types/lib/client";

import {ServiceInterface} from "../service-client";
import {BasicSparkplugNode, SPSettings} from "../sparkplug/basic-node";

export default class MQTTInterface extends ServiceInterface {

    /**
     * MQTTClient with build in GSSAPI for k8s Authentication
     * URL is can be custom if logging in with Basic Authentication
     * @param opts Options for MQTT Client
     */
    mqtt_client(opts?: mqttConfig): Promise<MqttClient>;
    basic_sparkplug_node (opts: SPSettings): BasicSparkplugNode;
}

export interface mqttConfig extends IClientOptions{

    /**
     * Boolean to enable debug logs
     */
    verbose?: boolean;

    /**
     * Period before reconnecting.
     */
    reconnectPeriod?: number;

}
