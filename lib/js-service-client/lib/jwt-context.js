/*
 * Factory+ NodeJS Utilities
 * Request-scoped JWT context shared with the service API library.
 * Copyright 2026 University of Sheffield AMRC
 */

/* Lives in service-client because it's a service-client concern (the
 * outbound fetch reads it). The service-api auth middleware writes it
 * when an inbound request authenticates with a Keycloak JWT, then runs
 * the rest of the express middleware chain inside the ALS scope so the
 * outbound call inherits it transparently.
 *
 * service-client also ships in browser-bundled apps (acs-admin via
 * Vite, etc.). node:async_hooks doesn't exist in the browser and
 * there's no inbound HTTP middleware there anyway, so we fall back to
 * a no-op stub. The `await import` pattern matches deps.js (GSS).
 * `await` + `import` must be on the same line to dodge a Rollup
 * semicolon-insertion bug. */
class StubALS {
    run (_, cb) { return cb(); }
    getStore () { return undefined; }
}
const ALS = await import("node:async_hooks")
    .then(mod => mod.AsyncLocalStorage ?? StubALS)
    .catch(() => StubALS);

export const jwt_context = new ALS();
