/* AMRC Connectivity Stack
 * Universal Robot RTDE Edge Agent driver
 * Copyright 2025 University of Sheffield AMRC
 */
import net from "net";
import { createRequire } from "module";
import { BufferX } from "@amrc-factoryplus/edge-driver";

const require = createRequire(import.meta.url);

// Import ur-rtde (CommonJS module with no main export, must specify file)
const ur = require("ur-rtde/ur.js");


// RTDEHandler class for Universal Robot RTDE protocol
export class RTDEHandler {
  constructor(driver, conf) {
    this.driver = driver;
    this.conf = conf;
    this.log = driver.debug.bound("rtde");

    // Create ur instance for parsing RTDE data
    this.urParser = new ur();

    // Set up the TCP socket for the southbound RTDE device
    this.client = new net.Socket();
    this.client.on("error", (err) => {
      this.log("RTDE client error: %o", err);
      this.driver.connFailed();
    });

    // Throttling configuration - read from conf
    this.throttleEnabled = conf.throttle !== false; // Default true unless explicitly set to false
    this.pollInt = conf.pollInt || 500; // Default 500ms (2Hz) if not specified
    this.latestState = null;
    this.publishTimer = null;

    if (this.throttleEnabled) {
      this.log(
        `RTDE throttling ENABLED: ${this.pollInt}ms (${(
          1000 / this.pollInt
        ).toFixed(2)}Hz)`
      );
    } else {
      this.log(`RTDE throttling DISABLED: Publishing immediately at ~125Hz`);
    }
  }

  static create(driver, conf) {
    if (!conf.host || !conf.port) return;
    return new RTDEHandler(driver, conf);
  }

  // Define fixed addresses for RTDE data
  // These are the data sections available from the UR RTDE protocol
  // Using 'json/' prefix to allow for future binary data transfer without breaking existing deployments
  get validAddrs() {
    return [
      "json/state", // Complete robot state (all data combined)
      "json/jointData", // Joint positions, velocities, currents, temperatures (array of 6 joints)
      "json/cartesianInfo", // TCP position and orientation
      "json/robotModeData", // Robot mode, speeds, emergency stop status
      "json/toolData", // Tool I/O, voltage, current, temperature
      "json/masterboardData", // Master board I/O, safety mode, voltage/current
      "json/forceModeFrame", // Force mode data
      "json/additionalInfo", // Freedrive button status
      "json/toolCommunicationInfo", // Tool communication settings
    ];
  }

  connect() {
    const { host, port } = this.conf;

    // Set up data handler BEFORE connecting
    this.client.on("data", (data) => {
      // Parse RTDE data using the ur parser
      const state = this.urParser.onData(data);
      if (state !== undefined) {
        if (this.throttleEnabled) {
          // Store latest state for throttled publishing
          this.latestState = state;
        } else {
          // Publish immediately without throttling
          this.handleData(state);
        }
      }
    });

    this.client.connect(port, host, () => {
      this.log(`✅ Connected to RTDE on ${host}:${port}`);
      this.driver.connUp();

      // Start throttled publishing only if enabled
      if (this.throttleEnabled) {
        this.startThrottledPublish();
      }
    });
  }

  // Start throttled publishing loop
  startThrottledPublish() {
    if (this.publishTimer) {
      clearInterval(this.publishTimer);
    }

    this.publishTimer = setInterval(() => {
      if (this.latestState) {
        this.handleData(this.latestState);
        // Don't clear latestState - keep it for next interval in case no new data arrives
      }
    }, this.pollInt);

    this.log(
      `✅ Started throttled publishing at ${this.pollInt}ms interval (${(
        1000 / this.pollInt
      ).toFixed(2)}Hz)`
    );
  }

  close(done) {
    if (this.publishTimer) {
      clearInterval(this.publishTimer);
      this.publishTimer = null;
    }
    this.client.once("close", done);
    this.client.end();
  }

  handleData(urState) {
    // Remove timestamp fields that cause InfluxDB overflow errors
    // The Edge Agent will automatically add system timestamps
    if (urState.robotModeData?.timestamp !== undefined) {
      delete urState.robotModeData.timestamp;
    }

    // Publish complete state
    this.driver.data("json/state", BufferX.fromJSON(urState));

    // Publish individual sections for more granular access
    if (urState.jointData) {
      this.driver.data("json/jointData", BufferX.fromJSON(urState.jointData));
    }
    if (urState.cartesianInfo) {
      this.driver.data(
        "json/cartesianInfo",
        BufferX.fromJSON(urState.cartesianInfo)
      );
    }
    if (urState.robotModeData) {
      this.driver.data(
        "json/robotModeData",
        BufferX.fromJSON(urState.robotModeData)
      );
    }
    if (urState.toolData) {
      this.driver.data("json/toolData", BufferX.fromJSON(urState.toolData));
    }
    if (urState.masterboardData) {
      this.driver.data(
        "json/masterboardData",
        BufferX.fromJSON(urState.masterboardData)
      );
    }
    if (urState.forceModeFrame) {
      this.driver.data(
        "json/forceModeFrame",
        BufferX.fromJSON(urState.forceModeFrame)
      );
    }
    if (urState.additionalInfo) {
      this.driver.data(
        "json/additionalInfo",
        BufferX.fromJSON(urState.additionalInfo)
      );
    }
    if (urState.toolCommunicationInfo) {
      this.driver.data(
        "json/toolCommunicationInfo",
        BufferX.fromJSON(urState.toolCommunicationInfo)
      );
    }
  }
}

