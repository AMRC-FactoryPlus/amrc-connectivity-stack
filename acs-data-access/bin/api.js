#!/usr/bin/env node

/*
* ACS Data Access Service
* Entry point: api.js
*/


import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import { routes } from '../lib/routes.js';
import { Version, Service } from '../lib/constants.js';
import {DataFlow} from '../lib/dataflow.js';

const { env } = process;

const fplus = await new RxClient({
  env,
}).init();


const debug = fplus.debug;
debug.log("app", "Starting acs-data-service revision %s", GIT_VERSION);

// the dataflow object is full of sequences that does most of the work of this service. Sequence means an RX observable.
const data = new DataFlow({
  fplus
});

// const api = await new WebAPI({
//   ping: {
//     version: Version,
//     service: UUIDs.Service.DataAccess,
//     software: {
//       vendor: 'AMRC',
//       application: 'acs-data-access',
//     },
//   },
//   debug: fplus.debug,
//   realm: env.REALM,
//   hostname: env.HOSTNAME,
//   keytab: env.SERVER_KEYTAB,
//   http_port: env.PORT,
//   max_age: env.CACHE_MAX_AGE,
//   routes: routes({
//     fplus,
//   }),
// }).init();

// api.run();

data.run();
