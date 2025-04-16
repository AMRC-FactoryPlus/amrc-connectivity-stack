#!/usr/bin/env node

import { ServiceClient } from '@amrc-factoryplus/service-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import { routes } from '../lib/routes.js';
import { Version, Service } from '../lib/constants.js';

import { fork } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const { env } = process;

const fplus = await new ServiceClient({
  env,
}).init();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const watcherProcess = fork(join(__dirname, 'watcher-runner-v1.js'));

watcherProcess.on('message', (msg) => {
  console.log(`Watcher says ${msg}`);
});

watcherProcess.on('exit', (code) => {
  console.log(`Watcher process exited with code ${code}`);
});

const uploadPath = env.FILES_STORAGE;

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
  body_type: 'raw',

  routes: routes({
    auth: fplus.Auth,
    configDb: fplus.ConfigDB,
    uploadPath: uploadPath,
  }),
}).init();

api.run();

