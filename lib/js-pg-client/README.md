# Factory+ Pg client library

This module provides basic logging and transaction facilities on top of
`node-postgres`.

## Connection recovery

A connection which fails is never reused. `DB.query` and `DB.txn` hand
a client back to the pool with the error whenever a query fails for any
reason other than an ordinary SQL error, and the pool closes it. The
next query opens a new connection.

A server which vanishes without closing its connections (a node
reboot, a network partition) sends no error at all, so two timeouts
turn silence into a failure:

| Option            | Environment               | Default | Meaning                                   |
|-------------------|---------------------------|---------|-------------------------------------------|
| `connect_timeout` | `PG_CONNECT_TIMEOUT_MS`   | 30000   | Wait for a connection, new or from the pool |
| `query_timeout`   | `PG_QUERY_TIMEOUT_MS`     | 60000   | Wait for the reply to one query           |

Both are in milliseconds and 0 means wait for ever. A service which
runs a single query for longer than a minute needs a larger
`query_timeout`.

`DB.txn` starts again on a new connection when `begin` fails on a dead
one. It does not repeat a transaction which fails part way through.

## Tests

`npm test` runs the tests. Those which need a server are skipped unless
`PGHOST` is set.
