/*
 * Factory+ NodeJS Utilities
 * Re-exports of libraries we use.
 * Copyright 2024 AMRC
 */

import { sp_remove_longs } from "./sparkplug/util.js";

/* No GSS on Windows. */
/* `await` and `import` must be on the same line to circumvent
 * a bug in Rollup where it insists on adding a semicolon after
 * the `await` keyword.
 */
/* Prefer our fork, which doesn't request credential delegation
 * (upstream's GSS_C_DELEG_FLAG costs a refused KDC round trip per
 * token when the TGT is not forwardable). Fall back to upstream
 * gssapi.js for consumers which don't have the fork installed. */
export const GSS = await import("@amrc-factoryplus/gssapi")
        .catch(e => import("gssapi.js"))
        .then(mod => mod.default)
        .catch(e => undefined);

/* Annoying re-export syntax... If you find yourself having to document
 * 'you can't do `export Foo from "foo"`' then maybe you should design
 * the syntax so you can... ? */
export { default as MQTT } from "mqtt";
export { default as WebSocket } from "isomorphic-ws";

export async function build_node_fetch () {
  /* We have to go round the houses a bit here... */
  const { got } = await import("got");
  const { createFetch } = await import("got-fetch");

  const configured_got = got.extend({
      cacheOptions: { shared: false },
  });
  const got_fetch = createFetch(configured_got);

  /* Bug fix */
  return (url, opts) => got_fetch(`${url}`, opts);
}

import * as sparkplug_payload from "sparkplug-payload";
export const SpB = sparkplug_payload.get("spBv1.0");

/* Add an additional function for now to decode to native types (Date
 * and BigInt). This may replace decodePayload in the future. */
SpB.decodeToNative = p => sp_remove_longs(SpB.decodePayload(p));

