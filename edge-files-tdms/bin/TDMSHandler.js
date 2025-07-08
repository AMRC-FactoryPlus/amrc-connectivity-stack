import { AsyncDriver } from "@amrc-factoryplus/edge-driver";
import { BufferX } from "@amrc-factoryplus/edge-driver";
import main from "./main.js";


export class TDMSHandler {
  constructor(driver, conf) {
    console.log("TDMSHandler: Constructor");
  
    this.driver = driver; 
    this.conf = conf;
    
    console.log(`TDMSHandler Conf: ${JSON.stringify(conf)}`);
    console.log("TDMSHandler: Driver instance:", driver);
  }

  static create(driver, conf) {
    console.log("TDMSHandler: Creating instance with config:", conf);
   
    this.log("TDMSHandler: Creating instance");
    if (conf.devicePath == null) return;
    const tdmsHandler = new TDMSHandler(driver, conf);
    console.log("tdmsHandler is ", tdmsHandler);
    return tdmsHandler;
  }

  async connect() {
    const { driver } = this;
    console.log("TDMSHandler: Connecting");
    
    console.log("TDMSHandler: Connected");
    this.log("TDMSHandler: Connected to main process");

    return "UP";
  }

  parseAddr(addr) {
    // It's easier to keep the addresses as just the whole nodeIds.
    return addr;
  }

  async subscribe(specs){
     const { driver } = this;
     console.log("TDMSHandler: Subscribing to specs:", specs);

    try {
      this.main = await main(driver, this.conf);

    }

    catch (err) {
      this.log("Subscription failed:", err);
      driver.connFailed();
      return false;
    }
  }
}