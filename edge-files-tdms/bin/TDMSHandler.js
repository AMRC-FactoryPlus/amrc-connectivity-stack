import { AsyncDriver } from "@amrc-factoryplus/edge-driver";
import { BufferX } from "@amrc-factoryplus/edge-driver";
import main from "./main.js";


export class TDMSHandler {
  constructor(driver, config) {
    console.log("TDMSHandler: Constructor");
    // this.eventManager = eventManager;
    // this.stateManager = stateManager;
    this.driver = driver; // Assuming driver is passed for data upload
    this.config = config;
    //this.log = driver.debug.bound("tdms-handler");
    console.log("TDMSHandler: Initialized with config:", config);
    console.log("TDMSHandler: Driver instance:", driver);
  }

  static create(driver, config) {
    console.log("TDMSHandler: Creating instance with config:", config);
    console.log("Handler called: conf %o", conf);
    this.log("TDMSHandler: Creating instance");
    //if (config.devicePath == null) return;
    const tdmsHandler = new TDMSHandler(driver, config);
    console.log("tdmsHandler is ", tdmsHandler);
    return tdmsHandler;
  }

  async connect() {
    const { driver } = this;
    console.log("TDMSHandler: Connecting");
    
    console.log("TDMSHandler: Connected");
    this.log("TDMSHandler: Connected to main process");
  }

  parseAddr(addr) {
    // It's easier to keep the addresses as just the whole nodeIds.
    return addr;
  }

  async subscribe(specs){
     const { driver } = this;
     console.log("TDMSHandler: Subscribing to specs:", specs);

    try {
      this.main = await main(driver, config);

    }

    catch (err) {
      this.log("Subscription failed:", err);
      driver.connFailed();
      return false;
    }
  }
}

//const tdmhandler = new TDMSHandler();

// const driver = new AsyncDriver({
//   env: process.env,
//   handler: TDMSHandler,
// });

// console.log(`Driver initialized: ${JSON.stringify(driver)}`);
//driver.run();
// driver.data("TestTDMS", JSON.stringify({timestamp: "2025-01-01T00:00:00Z", value: 123}));