#!/usr/bin/env node

import { ServiceClient } from '@amrc-factoryplus/service-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import { routes } from '../lib/api/routes.js';
import {clean_up} from "../lib/api/startup.js";
import { TDMSEventManager } from '../lib/tdms-file-events.js';
import IngesterRunner from '../lib/IngesterRunner.js';

const { env } = process;

const fplus = await new ServiceClient({
  env,
}).init();

const localUploadPath = env.TDMS_DIR_TO_WATCH;


const eventManager = new TDMSEventManager();

await clean_up({
  path : localUploadPath,
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
    uploadPath: localUploadPath,
    eventManager: eventManager,
  }),
}).init();

const ingesterRunner = new IngesterRunner({
  fplus: fplus,
  env: env,
  eventManager: eventManager,
});

api.run();

await ingesterRunner.run();
