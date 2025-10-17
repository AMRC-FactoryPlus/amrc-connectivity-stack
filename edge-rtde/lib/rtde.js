/* AMRC Connectivity Stack
 * Universal Robot RTDE Edge Agent driver
 * Copyright 2025 AMRC
 */
import net from "net";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BufferX } from "@amrc-factoryplus/edge-driver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Import ur-rtde from the local node_modules using relative path
const urPath = join(__dirname, "..", "node_modules", "ur-rtde", "ur.js");
const ur = require(urPath);

// RTDEHandler class for Universal Robot RTDE protocol
export class RTDEHandler {
  constructor(driver, conf) {
    this.driver = driver;
    this.conf = conf;
    this.log = driver.debug.bound("rtde");
    this.lastPoll = 0;
    this.tmp = 0;
    
    // Create ur instance for parsing RTDE data
    this.urParser = new ur();

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
    
    // Set up data handler BEFORE connecting
    this.client.on("data", (data) => {
      //this.log("Received raw data: %d bytes", data.length);
      
      // Parse RTDE data using the ur parser
      const state = this.urParser.onData(data);
      if (state !== undefined) {
        this.log("Parsed state successfully");
        //this.log("🔍 FULL STATE STRUCTURE: %s", JSON.stringify(state, null, 2));
        // specs will be set by subscribe() before data arrives
        if (this.specs) {
          this.handleData(state, this.specs);
        } else {
          this.log("WARNING: Received data but no specs set yet");
        }
      } else {
        this.log("Parser returned undefined (waiting for complete packet)");
      }
    });
    
    this.client.connect(port, host, () => {
      this.log(`✅ Connected to RTDE on ${host}:${port}`);
      this.driver.connUp();
    });
  }

  subscribe(specs) {
    //this.log("📡 SUBSCRIBE called with %d specs: %o", specs.length, specs);
    
    // Store specs for use in data handler
    this.specs = specs;
    
    // Return true to indicate successful subscription
    return true;
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

  handleData(urState, specs) {
    //this.log("handleData called with %d specs", specs.length);
    
    // Log the structure of the received data
    //this.log("📊 urState structure: %o", Object.keys(urState));
    //this.log("📊 urState.jointData exists: %s", urState.jointData !== undefined);
    if (urState.jointData) {
      //this.log("📊 jointData structure: %o", Object.keys(urState.jointData));
      if (urState.jointData.positionActual) {
        //this.log("📊 positionActual value: %o", urState.jointData.positionActual);
      }
    }
    
    // We return the same JSON object for all addresses.
    // Upstream, the user should extract values from this object with JSON paths.
    const urStateBuffer = BufferX.fromJSON(urState);
    
    //this.log("Sending data to %d addresses", specs.length);
    
    // Send the data to each subscribed address spec
    for (const spec of specs) {
      //this.log("Sending data for spec: %o", spec);
      this.driver.data(spec, urStateBuffer);
    }
  }
}

