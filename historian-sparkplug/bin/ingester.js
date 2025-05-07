import { ServiceClient } from "@amrc-factoryplus/service-client";
import MQTTClient from "../lib/mqttclient";
const deviceUUID = process.env.DEVICE_UUID;
const MQTTURL = process.env.MQTT_URL;
const sparkplugAddress = process.env.SPARKPLUG_ADDRESS;
if (!deviceUUID) {
    throw new Error("Device UUID not set");
}
if (!MQTTURL) {
    throw new Error("MQTT URL not set");
}
if (!sparkplugAddress) {
    throw new Error("Sparkplug Address not set");
}
const client = await new ServiceClient({
    directory_url: process.env.DIRECTORY_URL,
    root_principal: process.env.ROOT_PRINCIPAL,
}).init();
const mqtt = await new MQTTClient({
    e: {
        serviceClient: client,
        deviceUUID: deviceUUID,
        url: MQTTURL,
        sparkplugAddress: sparkplugAddress
    }
}).init();
mqtt.run();
