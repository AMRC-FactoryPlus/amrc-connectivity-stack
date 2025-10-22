#!/usr/bin/env node

import { RxClient } from '@amrc-factoryplus/rx-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import { routes } from '../lib/routes.js';
import { Version, Service } from '../lib/constants.js';
import {clean_up} from "../lib/startup.js";

const { env } = process;

const fplus = await new RxClient({
  env,
}).init();

const uploadPath = env.FILES_STORAGE;

await clean_up({
  path : uploadPath,
  fplus
});

const api = await new WebAPI({
  ping: {
    version: Version,
    service: Service.Files,
    software: {
      vendor: 'AMRC',
      application: 'acs-files',
    },
  },
  debug: fplus.debug,
  realm: env.REALM,
  hostname: env.HOSTNAME,
  keytab: env.SERVER_KEYTAB,
  http_port: env.PORT,
  max_age: env.CACHE_MAX_AGE,
  routes: routes({
    fplus,
    uploadPath: uploadPath,
  }),
}).init();

api.run();
