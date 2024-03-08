/*
 * Factory+ NodeJS Utilities
 * Re-exports of libraries we use.
 * Copyright 2024 AMRC
 */

/* No GSS on Windows. */
export const GSS = await
    import("gssapi.js")
        .then(mod => mod.default)
        .catch(e => undefined);

/* Annoying re-export syntax... If you find yourself having to document
 * 'you can't do `export Foo from "foo"`' then maybe you should design
 * the syntax so you can... ? */
export { default as MQTT } from "mqtt";

if ("fetch" in globalThis) {
  const fetch = globalThis.fetch;
}
else {
  /* We have to go round the houses a bit here... */
  import got from "got";
  import { createFetch } from "got-fetch";

  const configured_got = got.extend({
      cacheOptions: { shared: true },
  });
  const got_fetch = createFetch(configured_got);

  /* Bug fix */
  function fetch (url, opts) {
      return got_fetch(`${url}`, opts);
  }
}
export fetch;

import sparkplug_payload from "sparkplug-payload";
export const SpB = sparkplug_payload.get("spBv1.0");

