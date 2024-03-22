/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Protocol constants
 * Copyright 2022 AMRC
 */

import fs from "node:fs";

import { GIT_VERSION } from "./git-version.js";

/* This is the version of the ConfigDB service spec we comply to */
export const Version = "1.7.0";

export const Null_UUID = "00000000-0000-0000-0000-000000000000";

export const Class = {
    Class: "04a1c90d-2295-4cbe-b33a-74eded62cbf1",
    Device: "18773d6d-a70d-443a-b29a-3f1583195290",
    Schema: "83ee28d4-023e-4c2c-ab86-12c24e86372c",
    App: "d319bd87-f42b-4b66-be4f-f82ff48b93f0",
    Service: "265d481f-87a7-4f93-8fc6-53fa64dc11bb",
};

export const App = {
    Registration: "cb40bed5-49ad-4443-a7f5-08c75009da8f",
    Info: "64a8bfa9-7772-45c4-9d1a-9e6290690957",
    SparkplugAddress: "8e32801b-f35a-4cbf-a5c3-2af64d3debd7",
    ConfigSchema: "dbd8a535-52ba-4f6e-b4f8-9b71aefe09d3",
};

export const Schema = {
    Service: "05688a03-730e-4cda-9932-172e2c62e45c",
};

export const Service = {
    Registry: "af15f175-78a0-4e05-97c0-2a0bb82b9f3b",
};

export const Device_Info = {
    Manufacturer: "AMRC",
    Model: "AMRC Connectivity Stack (ACS) ConfigDB",
    Serial: GIT_VERSION,
};
