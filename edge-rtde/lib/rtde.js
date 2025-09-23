/* AMRC Connectivity Stack
 * Universal Robot RTDE Edge Agent driver
 * Copyright 2025 AMRC
 */
import net from "net";
import ur from "ur-rtde";

// RTDEHandler class for Universal Robot RTDE protocol
export class RTDEHandler {
  constructor(driver, conf) {
    this.driver = driver;
    this.conf = conf;
    this.log = driver.debug.bound("rtde");
    this.lastPoll = 0;
    this.tmp = 0;

    // Set up the TCP socket for the southbound RTDE device
    this.client = new net.Socket();
    this.client.on("error", (err) => {
      this.log("RTDE client error: %o", err)
      this.driver.connFailed();
    });
  }

  static create(driver, conf) {
    if (!conf.host || !conf.port)
      return;
    return new RTDEHandler(driver, conf);
  }

  connect() {
    const { host, port } = this.conf;
    this.client.connect(port, host, () => {
      this.log(`Connected to RTDE on ${host}:${port}`);
      this.driver.connUp();
    });
  }

  subscribe(_specs) {
    // The library requires us to subscribe to all data on the device
    this.client.on("data", (data) => {
      // This constructs a new urState object
      const state = new ur().onData(data);
      if (state !== undefined) {
        this.handleData(state);
      }
    });
  }

  async close() {
    return new Promise((resolve) => {
      this.client.once("close", () => {
        this.log("RTDE connection closed.");
        resolve();
      });

      this.client.end();
    });
  }

  handleData(urState) {
    // TODO: handle urState data
  }
}

