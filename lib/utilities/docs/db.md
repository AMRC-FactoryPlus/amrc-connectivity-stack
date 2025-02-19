# Database access API

```js
import { DB } from "@amrc-factoryplus/utilities";
```

This class provides a basic wrapper over a database connection. It supports checking the version of the database DDL and basic transaction and reconnection support.

## Constructor

```js
const db = new DB({
        version:    undefined,
        verbose:    false,
        readonly:   false,
        isolation:  "read committed",
        deferrable: false,
    });
```

The default options are shown; all are optional. Options are:

* `version`: If this is defined, then after connecting to the database the library will run `select version from version`. If this does not return one row matching the specified version an exception will be thrown.
* `verbose`: Log every query executed.
* `readonly`, `isolation`, `deferrable`: Set the transaction isolation mode.

After calling the constructor, call `await db.init()` to finish setup.

## Methods

### init

```js
await db.init();
```

Performs initial setup; this will check the database version if requested. Returns the database object.

### connect

    const cli = await db.connect();

The underlying library maintains a pool of connections to the database. This will attempt to retrieve a connection from the pool, and retry in case the database server is down. Returns a client connection which must be released with `cli.release()` when you have finished with it.

This method is normally called as needed by the other methods.

### query

```js
const dbr = await db.query(sql, params, verbose);
```

Obtain a connection and make an SQL query. `sql` is the query, as a string, with `$N` placeholders. `params` is an array of bind parameters.`verbose` optionally overrides the global setting.

### txn

```js
await db.txn(opts, async query => {...});
```

Obtain a connection, start a transaction and execute the supplied callback. `opts` has keys `verbose`, `readonly`, `isolation`,`deferrable` which override the global options. The `query` parameter to the callback is a function `query(sql, params)` to make an SQL query.

If the callback throws an exception the transaction will be rolled back. If the transaction fails because of a serialisation failure, it will be automatically retried, up to 5 times (see the Postgres docs for details of when this can occur).