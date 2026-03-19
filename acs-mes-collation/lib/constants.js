/*
 * ACS MES Collation
 * Protocol constants
 */

import { GIT_VERSION } from "./git-version.js";

/* Version of the MES Collation service spec */
export const Version = "0.1.0";

export const Service = {
    /* XXX Replace with a real UUID once registered in ConfigDB */
    MESCollation: "00000000-0000-0000-0000-000000000000",
};

export const Perm = {
    All: "00000000-0000-0000-0000-000000000000",
    Read: "00000000-0000-0000-0000-000000000000",
    Write: "00000000-0000-0000-0000-000000000000",
};

export const App = {
};

export const Device_Info = {
    Manufacturer: "AMRC",
    Model: "AMRC Connectivity Stack (ACS) MES Collation",
    Serial: GIT_VERSION,
};
