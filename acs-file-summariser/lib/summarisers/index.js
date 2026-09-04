/*
 * ACS File Summariser
 * Summariser plugin registry
 *
 * A plugin is a module exporting `defaultConfig` and an async generator
 * `summarise(filePath, config)` yielding `{ measurement, tags, fields,
 * timestamp }` rows. Adding support for a new file type is a new plugin
 * module plus one entry in this map - nothing else in the service is
 * file-type-specific.
 *
 * Copyright 2026 University of Sheffield
 */

import { FileType } from "../constants.js";
import * as tdms     from "./tdms.js";

export const Summarisers = new Map([
    [FileType.TDMS, tdms],
]);
