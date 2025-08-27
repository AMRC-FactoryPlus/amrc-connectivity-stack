import { AsyncDriver } from "@amrc-factoryplus/edge-driver";
import { BufferX } from "@amrc-factoryplus/edge-driver";
// import main from "./main.js";
import TDMSSummariser from "../lib/tdms-file-summariser.js";
import { ServiceClient } from '@amrc-factoryplus/service-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import { routes } from '../lib/api/routes.js';
import {clean_up} from "../lib/api/startup.js";
import { TDMSEventManager } from '../lib/tdms-file-events.js';
import IngesterRunner from '../lib/IngesterRunner.js';
import StateManager from '../lib/state-manager.js';


// export class TDMSHandler {
//   constructor(driver, conf) {
//     console.log("TDMSHandler: Constructor");
  
//     this.driver = driver; 
//     this.conf = conf;
//     //TDMSConn driver:eb669a2c-e213-11ef-998e-a7fc6f4817b5
//     // console.log(`TDMSHandler Conf: ${JSON.stringify(conf)}`);
//     //console.log("TDMSHandler: Driver instance:", driver);
//     this.summariser = new TDMSSummariser({
//       driver: driver,
//     });

//     // this.api = api;
//     // this.ingester = ingesterRunner;   
//   }

//   static create(driver, conf) {
//     //console.log("TDMSHandler: driver is ", driver);
//     //console.log("TDMSHandler: Creating instance with config:", conf);
   
//     //this.log("TDMSHandler: Creating instance");
//     //if (conf.devicePath == null) return;
//     const tdmsHandler = new TDMSHandler(driver, conf);
//     //console.log("tdmsHandler is ", tdmsHandler);
//     return tdmsHandler;
//   }

//   async connect() {
//     const { driver } = this;
//     //console.log("TDMSHandler: Connecting");
    
//     console.log("TDMSHandler: Connected");
//     //this.log("TDMSHandler: Connected to main process");
//     try{
//       // await this.summariser.uploadToInflux("TDMSTest", "specs.summary");
//       // this.api.run();

//       // await this.ingester.run();
//       return "UP";
//     }catch (err) {
//       console.error("TDMSHandler: Connection error:", err);
//       return "AUTH";
//     }

    
//   }

//   parseAddr(addr) {
//     // It's easier to keep the addresses as just the whole nodeIds.
//     return addr;
//   }

//   async subscribe(specs){
//      const { driver } = this;
//      //console.log("TDMSHandler: driver is ", driver);
//      console.log("TDMSHandler: Subscribing to specs:", specs);

//     try {
//       //this.main = await main(this.driver, this.conf);
//       await this.summariser.uploadToInflux(specs[0], "specs.summary"); 
//       console.log("TDMSHandler: Subscription should be successful");
//     }

//     catch (err) {
//       console.log("Subscription failed:", err);
//       driver.connFailed();
//       return false;
//     }
//   }
// }

const { env } = process;

const fplus = await new ServiceClient({
  env,
}).init();

const uploadPath = env.TDMS_DIR_TO_WATCH;

const eventManager = new TDMSEventManager();
const stateManager = new StateManager({ env: env });


await clean_up({
  path : uploadPath,
});


const api = await new WebAPI({
    ping: {
      version: "v1",
      service: "NA",
      software: {
        vendor: 'AMRC',
        application: 'edge-files-tdms',
      },
    },
    debug: fplus.debug,
    realm: env.REALM,
    principal: env.PRINCIPAL,
    keytab: env.CLIENT_KEYTAB,
    http_port: env.PORT,
    max_age: env.CACHE_MAX_AGE,
    routes: routes({
      fplus,
      uploadPath: uploadPath,
      eventManager: eventManager,
      stateManager: stateManager
    }),
  }).init();



export class Handler{
    constructor(driver, conf) {
      this.driver = driver; 
      this.conf = conf;

      
      const ingesterRunner = new IngesterRunner({
        fplus: fplus,
        env: env,
        eventManager: eventManager,
        stateManager: stateManager,
        driver: driver,
      });


      this.api = api;
      this.ingester = ingesterRunner;
    }

    static create(driver, conf) {
    //console.log("TDMSHandler: driver is ", driver);
    //console.log("TDMSHandler: Creating instance with config:", conf);
   
    this.log("Handler: Creating instance");
    if (conf.devicePath == null) return;
    const handler = new Handler(driver, conf);
    //console.log("tdmsHandler is ", tdmsHandler);
    return handler;
  }

    async connect() {
    const { driver } = this;
    
    
    console.log("Handler: Connected");
    
    try{
      // await this.summariser.uploadToInflux("TDMSTest", "specs.summary");
      this.api.run();

      await this.ingester.run();
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
      //console.log("TDMSHandler: driver is ", driver);
      console.log("TDMSHandler: Subscribing to specs:", specs);

      try {
        //this.main = await main(this.driver, this.conf);
        // await this.summariser.uploadToInflux(specs[0], "specs.summary"); 
        console.log("TDMSHandler: Subscription should be successful");
      }

      catch (err) {
        console.log("Subscription failed:", err);
        driver.connFailed();
        return false;
      }
    }

}