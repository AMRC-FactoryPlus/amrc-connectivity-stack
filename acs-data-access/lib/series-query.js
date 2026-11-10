/*
 * ACS Data Access Service
 * A Flux query to InfluxDB that can be stopped.
 *
 * The InfluxDB client's own query API cannot stop a query. Its
 * `cancel()` only stops the client reading: the HTTP request stays
 * open and InfluxDB runs the query to the end. A slow query that
 * nobody waits for then still costs InfluxDB its full time and
 * memory, and repeated requests stack up.
 *
 * This sends the same request through the client's transport with an
 * AbortSignal. Aborting closes the connection, and InfluxDB cancels a
 * query when its client goes away.
 */

import http from "node:http";
import https from "node:https";

import { InfluxDB, chunksToLines, linesToTables } from "@influxdata/influxdb-client";

/* Node hands a connection back to its agent as soon as a response is
 * complete. Aborting the request just after that destroys the idle
 * socket with an error, and an idle socket has no error listener, so
 * the error would end the process. The request's own errors still
 * reach the query through the request. */
const quiet = Agent => class extends Agent {
    createConnection (...args) {
        const socket = super.createConnection(...args);
        socket.on("error", () => {});
        return socket;
    }
};
const QuietHttp = quiet(http.Agent);
const QuietHttps = quiet(https.Agent);

/** Makes the InfluxDB client for series queries. Always use this
 * client with SeriesQuery: see the note on the agent above.
 * @param opts.url The InfluxDB URL.
 * @param opts.token The InfluxDB token.
 * @param opts.timeout The client's socket timeout in ms. */
export function series_influx (opts) {
    const Agent = String(opts.url).startsWith("https:") ? QuietHttps : QuietHttp;
    return new InfluxDB({
        ...opts,
        transportOptions: { agent: new Agent({ keepAlive: true }) },
    });
}

/* The annotated CSV the client's parser expects. */
const DIALECT = {
    header: true,
    delimiter: ",",
    quoteChar: '"',
    commentPrefix: "#",
    annotations: ["datatype", "group", "default"],
};

export class SeriesQuery {
    /**
     * @param opts.influx_client An InfluxDB client from series_influx.
     * @param opts.influx_org The InfluxDB org.
     */
    constructor (opts) {
        this.transport = opts.influx_client.transport;
        this.org = opts.influx_org;
    }

    /** Runs a Flux query and hands each row to the consumer, as the
     * client's `queryRows` does.
     * @param query The Flux script.
     * @param consumer `{ next(values, meta), error(err), complete() }`.
     * @param signal An AbortSignal. Aborting it closes the request. */
    queryRows (query, consumer, signal) {
        const path = `/api/v2/query?org=${encodeURIComponent(this.org)}`;
        const body = JSON.stringify({
            query: String(query),
            dialect: DIALECT,
            type: "flux",
        });
        const options = {
            method: "POST",
            headers: {
                "content-type": "application/json; encoding=utf-8",
                "accept-encoding": "identity",
            },
            signal,
        };
        this.transport.send(path, body, options,
            chunksToLines(linesToTables(consumer), this.transport.chunkCombiner));
    }
}
