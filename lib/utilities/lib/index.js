/*
 * Factory+ NodeJS Utilities
 * Main library entry point.
 * Copyright 2022 AMRC.
 */

export * from "@amrc-factoryplus/service-client";

export * from "./db.js";
export * from "./deps.js";
export * from "./sparkplug/util.js";
export * from "./util.js";
export * from "./webapi.js";

import { pkgVersion } from "./util.js";

export const Version = pkgVersion(import.meta);
