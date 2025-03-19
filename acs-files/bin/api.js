#!/usr/bin/env node

import { ServiceClient } from '@amrc-factoryplus/service-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import { routes } from '../lib/routes.js';
import multer from 'multer';
import { multer_storage } from '../config/multer.js';
import { Version, Service } from '../lib/constants.js';

const { env } = process;

const fplus = await new ServiceClient({
  env,
}).init();

const upload = multer({ storage: multer_storage });

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
  body_limit: env.BODY_LIMIT,

  routes: routes({
    auth: fplus.Auth,
    configDb: fplus.ConfigDB,
    upload: upload,
  }),
}).init();

api.run();
