/* AMRC Connectivity Stack
 * Universal Robot RTDE Edge Agent driver
 * Copyright 2025 AMRC
 */
import net from "net";
import ur from "./ur.js";

// RTDEHandler class for Universal Robot RTDE protocol
export class RTDEHandler {
  constructor(driver, conf) {
    this.driver = driver;
    this.conf = conf;
    this.log = driver.debug.bound("rtde");
    this.client = null;
    //this.samples = conf.samples || 5;
    this.polling = conf.polling || 1000; // Default polling interval (ms)
    this.lastPoll = 0;
    this.tmp = 0;
    this.on_close = () => {
      this.log("RTDE connection closed");
      driver.connFailed();
    };
  }

  static create(driver, conf) {
    if (!conf.host || !conf.port)
      return;
    return new RTDEHandler(driver, conf);
  }

  connect() {
    const { host, port } = this.conf;
    this.client = new net.Socket();
    this.client.on("close", this.on_close);

    return new Promise((resolve, reject) => {
      this.client.connect(port, host, () => {
        this.log(`Connected to RTDE on ${host}:${port}`);
        this.driver.connUp();
        resolve("UP");
      });

      this.client.on("data", (data) => {
        this.poll(data);
      });

      this.client.on("error", (err) => {
        this.log("RTDE client error: %o", err);
        this.driver.connFailed();
        reject("CONN");
      });
    });
  }

  close(done) {
    if (this.client) {
      this.client.off("close", this.on_close);
      this.client.destroy();
      this.client = null;
    }
    if (done) done();
  }

  parseAddr(addr) {
    
  }


  poll(data) {
    // Polling logic: only forward data at the configured interval
        // Parse RTDE data using ur.js
    const res = new ur().onData(data);
    if (res !== undefined) {
      //this.log("RTDE data: %s", JSON.stringify(res));
      // Forward parsed data to driver if needed
      if (this.driver.data) this.driver.data(res);
    }
    //this.tmp++;
    //if (this.tmp >= this.samples) {
    //  this.client.destroy();
    //}
  }
}

