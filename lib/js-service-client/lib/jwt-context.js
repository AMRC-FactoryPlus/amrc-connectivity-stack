/*
 * Factory+ NodeJS Utilities
 * Request-scoped JWT context shared with the service API library.
 * Copyright 2026 University of Sheffield AMRC
 */

import { AsyncLocalStorage } from "node:async_hooks";

/* Lives in service-client because it's a service-client concern (the
 * outbound fetch reads it). The service-api auth middleware writes it
 * when an inbound request authenticates with a Keycloak JWT, then runs
 * the rest of the express middleware chain inside the ALS scope so the
 * outbound call inherits it transparently. */
export const jwt_context = new AsyncLocalStorage();
