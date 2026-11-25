/*
 * ACS Admin
 * Permission UUIDs the admin UI checks before showing a control or page
 * Copyright 2026 University of Sheffield
 *
 * Each one is the permission the backing service checks for the
 * request the control makes. Keep them in step with the services.
 */

/* Literal wildcard target. A grant on it covers every target. */
export const WILDCARD = "00000000-0000-0000-0000-000000000000";

export const ConfigDB = {
    ReadApp:            "4a339562-cd57-408d-9d1a-6529a383ea4b",
    ReadMembers:        "d4fd61da-50ef-11f0-ad24-335234e4c8a2",
    ListObj:            "6b4d73ea-50f1-11f0-9333-132037a152a5",
    WriteApp:           "6c799ccb-d2ad-4715-a2a7-3c8728d6c0bf",
    CreateObj:          "ae09e2ba-50ef-11f0-ac03-1f9f5e6548be",
    CreateSpecificObj:  "e3491b9c-50f1-11f0-8e16-e75c8f93227b",
    DeleteObj:          "6957174b-7b08-45ca-ac5c-c03ab6928a6e",
    WriteMembers:       "c2759f6e-50ef-11f0-8730-ef0ba0514a0e",
    WriteMemberships:   "e08d89bc-50ef-11f0-8352-83e3d3d35028",
    WriteSubclasses:    "ed11bd2a-50ef-11f0-9f85-df13a1dff9e6",
    WriteSuperclasses:  "fb8e5048-50ef-11f0-91c5-7fd3cb373fbb",
};

export const Auth = {
    ReadACL:            "ba566181-0e8a-405b-b16e-3fb89130fbee",
    ReadKrb:            "e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c",
    WriteACL:           "3a41f5ce-fc08-4669-9762-ec9e71061168",
    WriteKrb:           "327c4cc8-9c46-4e1e-bb6b-257ace37b0f6",
};

export const Clusters = {
    Clusters:           "a40acff8-0c61-4251-bef3-d8d53e50cdd0",
};

export const CmdEsc = {
    Rebirth:            "fbb9c25d-386d-4966-a325-f16471d9f7be",
};

export const DataAccess = {
    CreateDataset:      "2d666b41-7a0d-4845-ad59-3113f25b469a",
    IncludeInUnion:     "94d51085-af83-4796-8059-fcd578e3f572",
    ReadDataset:        "ec48462e-37eb-4f56-8efa-83d813e85559",
    EditDataset:        "af06b9e5-456a-43e4-b636-5b17de28fc7f",
    DeleteDataset:      "6f301df8-0ad1-496f-8391-8de92c43ad8e",
    UseForSession:      "c089b9a9-06cd-4211-94fc-9ad52a759987",
    /* "Build datasets from device" (Device data), checked on the device. */
    UseDevice:          "788b049c-2831-11f1-99fd-2b0bf86d6f77",
};

export const Directory = {
    ReadAlertType:      "7b096c2f-9f0e-4da4-a644-5bd647a530f6",
    ReadDeviceAlerts:   "7e25ba20-f118-41da-a438-a7205f33b232",
};

export const MQTT = {
    ReadWholeNamespace: "81833dbb-1150-4078-b1db-978c646ba73e",
};

export const GatewayDepot = {
    Provision:          "f8a2ad0a-6a2f-4b1a-b8fe-958e7b01fd94",
};

export const UserAdmin = {
    ManageUsers:        "d4a080f8-eca7-4063-b22a-a6f14a4721eb",
};
