/*
 * Factory+ / AMRC Connectivity Stack (ACS) Directory component
 * Protocol constants
 * Copyright 2022 AMRC
 */

import fs from "node:fs";

const Service_UUID = "af4a1d66-e6f7-43c4-8a67-0fa3be2b1cf9";

const pkg = JSON.parse(fs.readFileSync("./package.json"));
const Version = pkg.version;

const Device_Info = {
    Manufacturer: "AMRC",
    Model: "AMRC Connectivity Stack (ACS) Directory",
    Serial: Version,
};

const Schema = {
    /* The metric leaf name that identifies a schema reference */
    leaf:   "Schema_UUID",
    Device_Information: "2dd093e9-1450-44c5-be8c-c0d78e48219b",
    Service: "05688a03-730e-4cda-9932-172e2c62e45c",    /* I am a service */
};

export {
    Version, Service_UUID, Device_Info, Schema,
};

