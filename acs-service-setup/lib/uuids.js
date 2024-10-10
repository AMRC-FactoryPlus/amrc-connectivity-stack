/* ACS service setup
 * UUIDs used by the services
 * Copyright 2023 AMRC
 */

export const ACS = {
    Class: {
        ClientRole:         "1c567e3c-5519-4418-8682-6086f22fbc13",
        EdgeAccount:        "97756c9a-38e6-4238-b78c-3df6f227a6c9",
        ServiceAccount:     "e463b4ae-a322-46cc-8976-4ba76838e908",
        Permission:         "8ae784bb-c4b5-4995-9bf6-799b3c7f21ad",
        UserAccount:        "8b3e8f35-78e5-4f93-bf21-7238bcb2ba9d",
        UserGroup:          "f1fabdd1-de90-4399-b3da-ccf6c2b2c08b",
    },
    App: {
        SchemaIcon:         "65c0ccba-151d-48d3-97b4-d0026a811900",
    },
    /* XXX These should probably be deployment-specific */
    Group: {
        Administrators:     "10fc06b7-02f5-45f1-b419-a486b6bc13ba",
        GlobalDebuggers:    "f76f8445-ce78-41c5-90ec-5964fb0cd431",
        SparkplugNode:      "1d3121a0-aade-4376-8fa3-57ba1460ba76",
        EdgeGroups:         "9ba0de4b-056f-4b5e-b966-2d5d85d07767",
        EdgePermissions:    "7594cd71-e5b9-4467-88c0-b11a66d47fec",
        CentralMonitor:     "1bc3dbca-68fe-48d2-9590-3a528c111827",
        SparkplugIngesters: "e414d355-b991-429b-8f5d-97e823ff71f5",
        HistorianUNS:       "03f5f08a-f61e-4134-8f66-b2951e3bbb69",
    },
    Perm: {
        MQTT: {
            ParticipateAsNode:  "a1314953-8226-44f4-8a3e-e87b09310579",
            RepresentDevices:   "e82456b3-a7d9-4971-9d8c-fd0be4545ab4",
            ReadAllStates:      "8790cf3d-b793-423c-b373-8cfcf9f63529",
            ReadNode:           "046d6603-fa62-4208-9400-65d61f8b1ec4",
            ReadWholeNamespace: "81833dbb-1150-4078-b1db-978c646ba73e",
            WriteToEntireUNS:   "9fa6ff20-9d2a-4444-960c-40ebcf56f5b4",
            ReadEntireUNS:      "ffa40b36-3a61-4545-832a-2d1e8b860d63",
        },
    },
    PermGroup: {
        Auth:                   "50b727d4-3faa-40dc-b347-01c99a226c58",
        Clusters:               "9e07fd33-6400-4662-92c4-4dff1f61f990",
        CmdEsc:                 "9584ee09-a35a-4278-bc13-21a8be1f007c",
        ConfigDB:               "c43c7157-a50b-4d2a-ac1a-86ff8e8e88c1",
        Directory:              "58b5da47-d098-44f7-8c1d-6e4bd800e718",
        Git:                    "c0c55c78-116e-4526-8ff4-e4595251f76c",
        MQTT:                   "a637134a-d06b-41e7-ad86-4bf62fde914a",
    },
    Schema: {
        ThreePhaseCircuitV1:    "0d3dbae6-3195-4249-9ca1-897221db016f",
        DirectCurrentCircuitV1: "462a55a1-d942-4fe8-83ff-63f66bf069d4",
        PowerMonitoringV1:      "481dbce2-cabc-4fb1-b402-ee51f49f62b0",
        PowerMonitoringV2:      "b6253da7-8d95-455c-bc42-23693ca95d46",
        SinglePhaseCircuitV1:   "d6de8765-bfbe-4f6b-b5d8-822dbd7f3a49",
        MonitorV1:              "e3ef732b-ee69-46f0-8d1d-8a9cec432d83",
    },
    Service: {
        Manager:                "619eecab-742d-4824-8b97-bcae472e5c04",
    },
    ServiceAccount: {},
    Role: {
        EdgeNodeConsumer:       "17a64293-b82d-4db4-af4d-63359bb62934",
        GlobalDebugger:         "4473fe9c-05b0-42cc-ad8c-8e05f6d0ca86",
        Warehouse:              "6958c812-fbe2-4e6c-b997-6f850b89f679",
    },
    /* XXX This should not be fixed. Currently this matches the fixed
     * UUID deployed by the dumps in the ACS Helm chart. This needs
     * changing to be per-deployment. */
    Device: {
        ConfigDB:               "36861e8d-9152-40c4-8f08-f51c2d7e3c25",
    },
};

/* XXX All the UUIDs below here are copied in from elsewhere in ACS.
 * They should be referenced instead, but it's not clear how to achieve
 * that. We can't just `import from "../acs-directory/lib/uuids.js"` as
 * this will not be part of the Docker build context. */

export const Clusters = {
    App: {
        Bootstrap:          "a807d8fc-63ff-48bb-85c7-82b93beb606e",
        Flux:               "72804a19-636b-4836-b62b-7ad1476f2b86",
        HelmRelease:        "88436128-09a3-4c9c-b7f4-b0e495137265",
        HelmTemplate:       "729fe070-5e67-4bc7-94b5-afd75cb42b03",
    },
    Class: {
        HelmChart:          "f9be0334-0ff7-43d3-9d8a-188d3e4d472b",
    },
    Requirement: {
        ServiceAccount:     "26d192cf-73c1-4c14-93cf-1e63743bab08",
    },
};

export const Directory = {
    Schema: {
        Alert:                  "8853aa15-2228-4309-b98e-e086cefbc72c",
    },
    Perm: {
        All:                    "58b5da47-d098-44f7-8c1d-6e4bd800e718",
        AdvertiseService:       "4db4c39a-f18d-4e83-aeb0-5af2c14ddc2b",
        ManageService:          "97dcf2a1-7f4b-476c-b561-e40fc42440ee",
        OverrideService:        "3bda2ab2-4128-463d-83c9-16b976a8d83e",
        ReadAlertType:          "7b096c2f-9f0e-4da4-a644-5bd647a530f6",
        PublishAlertType:       "8bceb6c8-d330-4130-a732-8db4993234b1",
        ReadDeviceAlerts:       "7e25ba20-f118-41da-a438-a7205f33b232",
        ReadLinkRelation:       "5a8defab-635f-46fa-8d1a-fbecaa1c2428",
        ReadDeviceLinks:        "b3dbdd15-f049-4a24-8ed3-9204537b8a22",
    },
};

export const Edge = {
    Class: {
        Alert:              "ddb853fc-262a-4a10-888a-816a961d37c5",
        LinkRelation:       "2bce9142-6b5b-4a5e-8e2f-f8a8d51d6c15",
    },
    App: {
        AgentConfig:        "aac6f843-cfee-4683-b121-6943bfdf9173",
        ClusterStatus:      "747a62c9-1b66-4a2e-8dd9-0b70a91b6b75",
        Deployment:         "f2b9417a-ef7f-421f-b387-bb8183a48cdb",
    },
    Perm: {
        ReloadConfig:       "6335f100-e68e-4e4d-b46d-85b42f85a036",
    },
    Role: {
        Monitor:            "4cb43b27-287c-4363-b819-944d567d4e48",
    },
    Alert: {
        Agent: {
            Connection:      "633a7da3-ea2a-4e3f-8e84-35691a07465f",
            ConfigInvalid:   "99c54cb2-2bb9-45c8-88f9-c1a0f792cfd6",
            ConfigFetch:     "c414c68b-5014-4e46-a0b4-d5f7f8df1d9f",
        },
        Monitor: {
            Offline:        "e6eff8b6-7b16-4827-9136-ac5202c0df59",
            Reload:         "bfa87a28-9788-45ab-922f-c4cb9eb9e742",
        },
    },
    Link: {
        Monitor: {
            Cluster:        "422d47e0-8761-43da-abd4-4f2adaef0d4a",
            Node:           "ec916189-f4f9-4fc7-af7e-724cc216e9e9",
        },
    },
};

export const Fixup = {
    Role: {
        EdgeNode:           "87e4a5b7-9a89-4796-a216-39666a47b9d2",
    },
    User: {
        Administrator:      "d53f476a-29dd-4d79-b614-5b7fe9bc8acf",
    },
};

export const Git = {
    App: {
        Config:     "38d62a93-b6b4-4f63-bad4-d433e3eaff29",
    },
    Class: {
        Repo:       "d25f2afc-1ab8-4d27-b51b-d02314624e3e",
        Group:      "b03d4dfe-7e78-4252-8e62-af594cf316c9",
    },
    Service: {
        Git:        "7adf4db0-2e7b-4a68-ab9d-376f4c5ce14b",
    },
    Perm: {
        All:        "c0c55c78-116e-4526-8ff4-e4595251f76c",
        Create:     "3668660f-f949-4657-be76-21967144c1a2",
        Delete:     "55870092-91b6-4d5e-828f-7637d080bf1c",
        Pull:       "12ecb694-b4b9-4d2a-927e-d100019f7ebe",
        Push:       "b2d8d437-5060-4202-bcc2-bd2beda09651",
    },
};
