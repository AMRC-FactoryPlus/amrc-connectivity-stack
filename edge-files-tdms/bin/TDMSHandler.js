#!/usr/bin/env node

import { ServiceClient } from '@amrc-factoryplus/service-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import { routes } from '../lib/api/routes.js';
import {clean_up} from "../lib/api/startup.js";
import { TDMSEventManager } from '../lib/tdms-file-events.js';
import IngesterRunner from '../lib/IngesterRunner.js';
import StateManager from '../lib/state-manager.js';


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
      // console.log("Handler: api is ", this.api);
      this.ingester = ingesterRunner;
      this.api.run();
      this.ingester.run();
    }

    static create(driver, conf) {
    console.log("Handler: driver is ", driver);
    console.log("TDMSHandler: Creating instance with config:", conf);
   
    // console.log("Handler: Creating instance");
    if (conf.devicePath == null) return;
    const handler = new Handler(driver, conf);
    
    //console.log("Handler is ", handler);
    return handler;
  }

    async connect() {
    const { driver } = this;
    
    
    console.log("Handler: Connected");
    
    try{
      // await this.summariser.uploadToInflux("TDMSTest", "specs.summary");
      // this.api.run();

      // await this.ingester.run();
      return "UP";
    }catch (err) {
      // console.error("TDMSHandler: Connection error:", err);
      return "AUTH";
    }

    
    }

    parseAddr(addr) {
      // It's easier to keep the addresses as just the whole nodeIds.
      console.log("Handler: parseAddr called with addr:", addr);
      return addr;
    }

}
