/*
 * Factory+ NodeJS Utilities
 * Re-exports of libraris we use.
 * Copyright 2022 AMRC
 */

/* We import and re-export the important library functions here, because
 * the libraries used may change in the future and this provides a
 * consistent interface.
 */

import { createRequire } from "module";

/* The 'pg' module is not properly ESM-compatible. While pure-JS use can
 * be accomplished with `import Pg from "pg"` this does not provide
 * access to the native (libpq) bindings. They are only available via
 * CommonJS import. */
const require = createRequire(import.meta.url);
const pg_cjs = require("pg");
export const Pg = pg_cjs.native ?? pg_cjs;

