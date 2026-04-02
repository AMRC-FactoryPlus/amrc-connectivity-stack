#!/usr/bin/env node

/*
* ACS Data Access Service
* Entry point: api.js
*/


import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import {DataFlow} from '../lib/dataflow.js';
import { APIv1 } from '../lib/api-v1.js';
import {DataAccessNotify} from '../lib/notify.js';

const { env } = process;

const fplus = await new RxClient({
  env,
}).init();

const Version = "2.0.0";

const debug = fplus.debug;
debug.log("app", "Starting acs-data-service revision %s");


// the dataflow object is full of sequences that does most of the work of this service. Sequence means an RX observable.
const data = new DataFlow({
  fplus
});


const apiv1 = new APIv1({ data, debug, auth: fplus.Auth, cdb: fplus.ConfigDB });

const api = await new WebAPI({
  debug: fplus.debug,
  ping: {
    version: Version,
    service: UUIDs.Service.DataAccess,
    software: {
      vendor: 'AMRC',
      application: 'acs-data-access',
    },
  },
  realm: env.REALM,
  hostname: env.HOSTNAME,
  keytab: env.SERVER_KEYTAB,
  http_port: env.PORT,
  max_age: env.CACHE_MAX_AGE,
  routes: app => {
    app.use("/v1", apiv1.routes);
  }
}).init();


const notify = new DataAccessNotify({
  api, data, debug,
  auth: fplus.Auth
});

debug.log("app", "Running Data Access DataFlow");
data.run();

debug.log("app", "Running Data Access Notify");
notify.run();

debug.log("app", "Running Data Access WebAPI")
api.run();





