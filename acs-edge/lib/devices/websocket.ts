/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { Device, deviceOptions, DeviceConnection } from "../device.js";
import { log } from "../helpers/log.js";
import { SparkplugNode } from "../sparkplugNode.js";
import { sparkplugMetric, Metrics, parseValueFromPayload, writeValuesToPayload } from "../helpers/typeHandler.js";
import { WebSocket } from "ws";
import * as util from "util";

export default interface wsConnDetails {
  url: string
}

export class WebsocketConnection extends DeviceConnection {
  #URL: string
  #ws: WebSocket
  constructor(type: string, connDetails: wsConnDetails) {
    super(type);
    this.#URL = connDetails.url;
    this.#ws = new WebSocket(this.#URL);

    this.#ws.on("open", () => {
      log(`Websocket connected to ${this.#URL}.`);
      this.emit("open");
    });

    this.#ws.on("message", (msg) => {
      // this.emit("asyncData", msg);
      this.emit('data', { '': msg });
    });

    this.#ws.on('error', (err) => {
      console.log(err);
    })
  }

  open() {


  }

  /**
   * Write specified metrics to device connection
   * @param {Array} metrics Array of metric objects to write to device connection
   */
  writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat?: string, delimiter?: string) {
    let err: Error|null = null;
    let payload = writeValuesToPayload(metrics.array, payloadFormat || "");
    if (payload && payload.length) {
      this.#ws.send(payload, (err) => {
        writeCallback(err);
      })
    } else {
      err = new Error("Value error");
      writeCallback(err);
    }
  }
  /**
   * Close connection and tidy up
   */
  async close() {
    this.#ws.close()
  }
};
