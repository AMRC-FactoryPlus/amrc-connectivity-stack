/*
 * Factory+ Sparkplug visualiser.
 * Webpack entry module.
 * Copyright 2022 AMRC.
 */

import MQTT from "mqtt";
import sparkplug_payload from "sparkplug-payload";
import EventEmitter from "events";

const SpB = sparkplug_payload.get("spBv1.0");

export { EventEmitter, MQTT, SpB };
