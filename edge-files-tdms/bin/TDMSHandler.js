import { AsyncDriver } from "@amrc-factoryplus/edge-driver";
import { BufferX } from "@amrc-factoryplus/edge-driver";
// import main from "./main.js";
import TDMSSummariser from "../lib/tdms-file-summariser.js";


export class TDMSHandler {
  constructor(driver, conf) {
    console.log("TDMSHandler: Constructor");
  
    this.driver = driver; 
    this.conf = conf;
    //TDMSConn driver:eb669a2c-e213-11ef-998e-a7fc6f4817b5
    // console.log(`TDMSHandler Conf: ${JSON.stringify(conf)}`);
    //console.log("TDMSHandler: Driver instance:", driver);
    this.summariser = new TDMSSummariser({
      driver: driver,
    });
  }

  static create(driver, conf) {
    //console.log("TDMSHandler: driver is ", driver);
    console.log("TDMSHandler: Creating instance with config:", conf);
   
    //this.log("TDMSHandler: Creating instance");
    //if (conf.devicePath == null) return;
    const tdmsHandler = new TDMSHandler(driver, conf);
    console.log("tdmsHandler is ", tdmsHandler);
    return tdmsHandler;
  }

  async connect() {
    const { driver } = this;
    console.log("TDMSHandler: Connecting");
    
    console.log("TDMSHandler: Connected");
    //this.log("TDMSHandler: Connected to main process");
    try{
      // await this.summariser.uploadToInflux("TDMSTest", "specs.summary");
      return "UP";
    }catch (err) {
      console.error("TDMSHandler: Connection error:", err);
      return "AUTH";
    }

    
  }

  parseAddr(addr) {
    // It's easier to keep the addresses as just the whole nodeIds.
    return addr;
  }

  async subscribe(specs){
     const { driver } = this;
     console.log("TDMSHandler: driver is ", driver);
     console.log("TDMSHandler: Subscribing to specs:", specs);

    try {
      //this.main = await main(this.driver, this.conf);
      await this.summariser.uploadToInflux(specs[0], "specs.summary"); 
      console.log("TDMSHandler: Subscription should be successful");
    }

    catch (err) {
      console.log("Subscription failed:", err);
      driver.connFailed();
      return false;
    }
  }
}