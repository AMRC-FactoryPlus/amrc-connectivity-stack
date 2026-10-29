/*
 * ACS Briefcase exporter
 * Small helpers
 * Copyright 2026 University of Sheffield
 */

/** Copy an object without its null and undefined properties, so they
 * don't appear in the JSON at all. */
export function defined (obj) {
    return Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v != null));
}
