/*
 * ACS ISA-95 placement watcher
 * Protocol constants
 * Copyright 2026 University of Sheffield AMRC
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

const { Class } = UUIDs;

/* The classes of ISA-95 vocabulary nodes, by level name. */
export const LevelClass = {
    "Enterprise":   Class.ISA95Enterprise,
    "Site":         Class.ISA95Site,
    "Area":         Class.ISA95Area,
    "Work Center":  Class.ISA95WorkCenter,
    "Work Unit":    Class.ISA95WorkUnit,
};
