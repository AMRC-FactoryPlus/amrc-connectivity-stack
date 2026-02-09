#!/usr/bin/env node

import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import { routes } from '../lib/routes.js';
import { Version, Service } from '../lib/constants.js';
import { clean_up } from "../lib/startup.js";

const { env } = process;

const fplus = await new RxClient({
  env,
}).init();

const api = await new WebAPI({
  ping: {
    version: Version,
    service: UUIDs.Service.ExampleService,
    software: {
      vendor: 'AMRC',
      application: 'acs-example-service',
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
  }),
}).init();

api.run();
