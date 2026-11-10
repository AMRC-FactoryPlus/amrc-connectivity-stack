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
import { SeriesReader, SERIES_DEFAULTS } from '../lib/series-reader.js';
import { Coverage, InfluxAdmin } from '../lib/coverage-service.js';
import { COVERAGE_DEFAULTS } from '../lib/coverage.js';
import { body_errors } from '../lib/utils.js';
import { DefaultDatasets } from '../lib/default-datasets.js';

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

// The bucket each store reads. `sparkplug` is historian-sparkplug's
// bucket, which existing datasets read. `uns` is historian-uns's
// bucket, which the UNS device kinds read; without it they answer 503.
const buckets = {
  sparkplug: env.INFLUXDB_BUCKET,
  ...(env.INFLUXDB_UNS_BUCKET ? { uns: env.INFLUXDB_UNS_BUCKET } : {}),
};


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
  buckets,
})

// The coverage summary: Data Access creates its bucket and InfluxDB
// task on every start, then backfills and repairs it in the background.
// Its queries go through InfluxAdmin, which can abort them: a backfill
// day returns nothing until InfluxDB has written it, so they get a long
// timeout (COVERAGE_TIMEOUT_MS). A query that hits it is aborted, which
// closes the connection so InfluxDB can cancel it.
const influxAdmin = new InfluxAdmin({
  url: env.INFLUXDB_URL,
  token: env.INFLUXDB_TOKEN,
  timeout_ms: Number(env.COVERAGE_TIMEOUT_MS) || COVERAGE_DEFAULTS.timeout_ms,
});
const coverage = new Coverage({
  debug,
  admin: influxAdmin,
  org: env.INFLUXDB_ORG,
  raw_bucket: buckets.sparkplug,
  env,
});

// The UNS bucket gets a summary of its own: both buckets key on the
// device, so one summary of both would count every device twice.
// historian-uns creates the bucket when it starts, which may be after
// Data Access; until then this one keeps retrying.
const uns_coverage = buckets.uns
  ? new Coverage({
      debug,
      admin: influxAdmin,
      org: env.INFLUXDB_ORG,
      raw_bucket: buckets.uns,
      suffix: "uns",
      wait_for_raw: true,
      env,
    })
  : null;
const coverages = [coverage, uns_coverage].filter(c => c);

// The series route has its own limiter and timeout, separate from the
// CSV export, so a long download does not stall the timeline. Its
// InfluxDB client waits a little longer than the query timeout:
// InfluxDB sends an aggregate's rows only when it has them all, and
// the client's default 10 s timeout ended slow queries first.
const series_query_ms = Number(env.SERIES_QUERY_TIMEOUT_MS)
  || SERIES_DEFAULTS.query_timeout_ms;
const seriesInflux = new InfluxDB({
  url: env.INFLUXDB_URL,
  token: env.INFLUXDB_TOKEN,
  timeout: series_query_ms + 5000,
});
const seriesReader = new SeriesReader({
  debug,
  influx_client: seriesInflux,
  influx_org: env.INFLUXDB_ORG,
  buckets,
  concurrency: env.SERIES_CONCURRENCY,
  timeout_ms: env.SERIES_TIMEOUT_MS,
  query_timeout_ms: series_query_ms,
  max_queue: env.SERIES_MAX_QUEUE,
  coverages: {
    sparkplug: coverage.enabled ? coverage : null,
    uns: uns_coverage?.enabled ? uns_coverage : null,
  },
});

const apiv1 = new APIv1({ 
  data,
  debug,
  auth: fplus.Auth,
  cdb: fplus.ConfigDB,
  influxReader,
  seriesReader,
  buckets,
});

// Every placed device gets a default UNS device dataset. A site with
// no UNS bucket cannot read one, so it makes none.
const defaults = new DefaultDatasets({
  data,
  debug,
  cdb: fplus.ConfigDB,
  enabled: !!buckets.uns,
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
  // Data Access checks dataset permissions itself and writes to the
  // ConfigDB with its own rights, so it never forwards a caller's JWT.
  forward_jwt: false,
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
for (const c of coverages) c.run();

debug.log("app", "Running Data Access default datasets");
defaults.run();

/* Stop the background coverage work, then exit as the signal would. */
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    for (const c of coverages) c.stop();
    defaults.stop();
    process.kill(process.pid, signal);
  });
}





