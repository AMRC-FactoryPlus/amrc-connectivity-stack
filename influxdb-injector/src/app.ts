/*
 * AMRC InfluxDB Sparkplug Ingester
 * Copyright "2023" AMRC
 */

import MQTTClient from "./mqttclient.js";


const mqtt = await new MQTTClient().init();

mqtt.run();
