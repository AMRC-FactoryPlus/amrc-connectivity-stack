/*
 * ACS MES Collation
 * Protocol constants
 */

import { GIT_VERSION } from "./git-version.js";

/* Version of the MES Collation service spec */
export const Version = "0.1.0";

export const Service = {
    MESCollation: "a7f3b2c8-5e4d-4f1a-9c8b-6a2d5e0f4b1c",
};

export const Perm = {
    All: "00000000-0000-0000-0000-000000000000",
    Read: "00000000-0000-0000-0000-000000000000",
    Write: "00000000-0000-0000-0000-000000000000",
};

export const App = {
    /* ConfigDB application holding MES device identifiers */
    MESIdentifiers: "af178f0c-3b1e-44f2-9724-5cf06e8fd056",
};

export const Device_Info = {
    Manufacturer: "AMRC",
    Model: "AMRC Connectivity Stack (ACS) MES Collation",
    Serial: GIT_VERSION,
};
