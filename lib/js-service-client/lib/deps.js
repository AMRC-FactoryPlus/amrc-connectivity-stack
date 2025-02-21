/*
 * Factory+ NodeJS Utilities
 * Re-exports of libraries we use.
 * Copyright 2024 AMRC
 */

/* No GSS on Windows. */
/* `await` and `import` must be on the same line to circumvent
 * a bug in Rollup where it insists on adding a semicolon after
 * the `await` keyword.
 */
export const GSS = await import("gssapi.js")
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

