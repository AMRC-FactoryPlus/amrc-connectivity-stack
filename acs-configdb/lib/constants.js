/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Protocol constants
 * Copyright 2022 AMRC
 */

import { GIT_VERSION } from "./git-version.js";

/* This is the version of the ConfigDB service spec we comply to */
export const Version = "2.0.0";

export const Null_UUID = "00000000-0000-0000-0000-000000000000";

export const Class = {
    Individual: "2494ae9b-cd87-4c01-98db-437a303b43e9",
    Class: "04a1c90d-2295-4cbe-b33a-74eded62cbf1",
    R2Class: "705888ce-53fa-434d-afee-274b331d4642",
    R3Class: "52b80183-6998-4bf9-9b30-132755e7dede",

    Device: "18773d6d-a70d-443a-b29a-3f1583195290",
    Schema: "83ee28d4-023e-4c2c-ab86-12c24e86372c",
    App: "d319bd87-f42b-4b66-be4f-f82ff48b93f0",
    Service: "265d481f-87a7-4f93-8fc6-53fa64dc11bb",
    SpecialObj: "ddb132e4-5cdd-49c8-b9b1-2f35879eab6d",
};

export const App = {
    Registration: "cb40bed5-49ad-4443-a7f5-08c75009da8f",
    Info: "64a8bfa9-7772-45c4-9d1a-9e6290690957",
    SparkplugAddress: "8e32801b-f35a-4cbf-a5c3-2af64d3debd7",
    ConfigSchema: "dbd8a535-52ba-4f6e-b4f8-9b71aefe09d3",
};

export const SpecialObj = {
    Wildcard:   "00000000-0000-0000-0000-000000000000",
    Unowned:    "091e796a-65c0-4080-adff-c3ce01a65b2e",
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

export const Perm = {
    All: "c43c7157-a50b-4d2a-ac1a-86ff8e8e88c1",
    ReadApp: "4a339562-cd57-408d-9d1a-6529a383ea4b",
    WriteApp: "6c799ccb-d2ad-4715-a2a7-3c8728d6c0bf",
    ManageObj: "f0b7917b-d475-4888-9d5a-2af96b3c26b6",
    DeleteObj: "6957174b-7b08-45ca-ac5c-c03ab6928a6e",
    ManageApp: "95c7cbcb-ce60-49ed-aa81-2fe3eec4559d",
    GiveTo: "4eaab346-4d1e-11f0-800e-dfdc061c6a63",
    TakeFrom: "6ad67652-5009-11f0-9404-73b79124c3d5",
};

export const BootstrapUUIDs = { App, Perm, SpecialObj };

