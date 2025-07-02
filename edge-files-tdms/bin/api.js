#!/usr/bin/env node

import { ServiceClient } from '@amrc-factoryplus/service-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import { routes } from '../lib/api/routes.js';
// import { Version, Service } from '../lib/constants.js';
// import {clean_up} from "../lib/api/startup.js";
import IngesterRunner from '../lib/IngesterRunner.js';

const { env } = process;

const fplus = await new ServiceClient({
  env,
}).init();

const uploadPath = env.FILES_STORAGE;

// await clean_up({
//   path : uploadPath,
//   fplus
// });

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
  }),
}).init();

const ingesterRunner = new IngesterRunner({
  fplus: fplus,
  SERVICE_USERNAME: env.SERVICE_USERNAME,
  SERVICE_PASSWORD: env.SERVICE_PASSWORD,
  STATE_FILE: env.STATE_FILE,
  TDMS_DIR_TO_WATCH: env.TDMS_DIR_TO_WATCH,
  TDMS_SRC_DIR: env.TDMS_SRC_DIR,
  NODE_ENV: env.NODE_ENV,
  PYTHON_SUMMARISER_SCRIPT: env.PYTHON_SUMMARISER_SCRIPT,
}).init();


api.run();

// ingesterRunner.run()
// .catch(err => {
//   console.error("Fatal error:", err);
//   process.exit(1);
// });
