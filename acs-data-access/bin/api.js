#!/usr/bin/env node

/*
* ACS Data Access Service
* Entry point: api.js
*/

import {InfluxDB, flux} from '@influxdata/influxdb-client';

import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client';
import { WebAPI } from '@amrc-factoryplus/service-api';
import {DataFlow} from '../lib/dataflow.js';
import { APIv1 } from '../lib/api-v1.js';
import {DataAccessNotify} from '../lib/notify.js';
import { InfluxReader } from '../lib/influx-reader.js';
import { SeriesReader } from '../lib/series-reader.js';
import { Coverage, InfluxAdmin } from '../lib/coverage-service.js';
import { body_errors } from '../lib/utils.js';

const { env } = process;

const fplus = await new RxClient({
  env,
}).init();

const Version = "2.0.0";

const debug = fplus.debug;
debug.log("app", "Starting acs-data-service revision %s");

const influxClient = new InfluxDB({
  url: env.INFLUXDB_URL,
  token: env.INFLUXDB_TOKEN
});


// the dataflow object is full of sequences that does most of the work of this service. Sequence means an RX observable.
const data = new DataFlow({
  debug,
  cdb: fplus.ConfigDB,
  auth: fplus.Auth,
});

const influxReader = new InfluxReader({
  debug,
  influx_client: influxClient,
  influx_org: env.INFLUXDB_ORG,
  influx_bucket: env.INFLUXDB_BUCKET,
})

// The coverage summary: Data Access creates its bucket and InfluxDB
// task on every start, then backfills and repairs it in the background.
// Its queries go through InfluxAdmin, which can abort them: a backfill
// day returns nothing until InfluxDB has written it, so they get a long
// timeout (COVERAGE_TIMEOUT_MS), and a query that hits it is cancelled
// in InfluxDB too.
const coverage = new Coverage({
  debug,
  admin: new InfluxAdmin({ url: env.INFLUXDB_URL, token: env.INFLUXDB_TOKEN }),
  org: env.INFLUXDB_ORG,
  raw_bucket: env.INFLUXDB_BUCKET,
  env,
});

// The series route has its own limiter and timeout, separate from the
// CSV export, so a long download does not stall the timeline.
const seriesReader = new SeriesReader({
  debug,
  influx_client: influxClient,
  influx_org: env.INFLUXDB_ORG,
  influx_bucket: env.INFLUXDB_BUCKET,
  concurrency: env.SERIES_CONCURRENCY,
  timeout_ms: env.SERIES_TIMEOUT_MS,
  query_timeout_ms: env.SERIES_QUERY_TIMEOUT_MS,
  max_queue: env.SERIES_MAX_QUEUE,
  coverage: coverage.enabled ? coverage : null,
});

const apiv1 = new APIv1({ 
  data,
  debug,
  auth: fplus.Auth,
  cdb: fplus.ConfigDB,
  influxReader,
  seriesReader,
});

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
    // Malformed or oversized bodies get a JSON 400 or 413, not a 500.
    app.use(body_errors);
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

/* In the background: the series route counts raw data until the
 * summary is ready. */
coverage.run();

/* Stop the background coverage work, then exit as the signal would. */
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    coverage.stop();
    process.kill(process.pid, signal);
  });
}





