#!/usr/bin/env node

import { ServiceClient } from '@amrc-factoryplus/service-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import { Auth } from '../lib/auth.js';
import { ConfigDB, Auth } from '@amrc-factoryplus/service-client/interface.js';
import { routes } from '../lib/routes.js';
import multer from 'multer';
import { multer_storage } from '../config/multer.js';

const { env } = process;

const fplus = await new ServiceClient({
  env,
}).init();

const configDb = await new ConfigDB(fplus);
const auth = await new Auth(fplus);

multer({ storage: multer_storage });

const api = await new WebAPI({
  ping: {
    version: Version,
    service: Service.Registry,
    device: env.DEVICE_UUID,
    software: {
      vendor: 'AMRC',
      application: 'acs-files',
      revision: GIT_VERSION,
    },
  },
  debug: fplus.debug,
  realm: env.REALM,
  hostname: env.HOSTNAME,
  keytab: env.SERVER_KEYTAB,
  http_port: env.PORT,
  max_age: env.CACHE_MAX_AGE,
  body_limit: env.BODY_LIMIT,

  routes: routes({ auth, configDb, multer }),
}).init();

api.run();
