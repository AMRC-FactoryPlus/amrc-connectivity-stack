/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

export const ACS = {
    Class: {
        EdgeDeployment:     "e6f6a6e6-f6b2-422a-bc86-2dcb417a362a",
    },
    App: {
        SchemaIcon:         "65c0ccba-151d-48d3-97b4-d0026a811900",
        MQTTPermTemplate:   "1266ddf1-156c-4266-9808-d6949418b185",

    },
    /* XXX These might really be Applications? For now they are
     * well-known to the Auth service; they are perhaps 'classes of
     * name'. */
    Identity: {
        Kerberos:           "75556036-ce98-11ef-9534-637ef5d37456",
        Sparkplug:          "7c51a61a-ce98-11ef-834a-976fb7c5dd4c",
    },
    /* XXX These should probably be deployment-specific */
    Group: {
        Administrator:      "10fc06b7-02f5-45f1-b419-a486b6bc13ba",
        SparkplugReader:    "f76f8445-ce78-41c5-90ec-5964fb0cd431",
        SparkplugNode:      "1d3121a0-aade-4376-8fa3-57ba1460ba76",
        ServicePermissions: "a31b1902-be03-11ef-8347-6f18501a5e9e",
        CentralMonitor:     "1bc3dbca-68fe-48d2-9590-3a528c111827",
    },
    Perm: {
        Composite: {
            CmdEsc:             "dbd0c099-6c59-4bc6-aa92-4ba8a9b543f4",
            EdgeNode:           "87e4a5b7-9a89-4796-a216-39666a47b9d2",
            EdgeNodeConsumer:   "17a64293-b82d-4db4-af4d-63359bb62934",
            PrimaryApp:         "c0d17bcf-2a90-40e5-b244-07bf631f7417",
            Warehouse:          "6958c812-fbe2-4e6c-b997-6f850b89f679",
        },
        Auth: {
            ReadIdentity:       "e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c",
            ManageIdentity:     "327c4cc8-9c46-4e1e-bb6b-257ace37b0f6",
        },
        MQTT: {
            IssueCommands:      "50f1e694-7e18-4930-aa59-97cc90a6a1ec",
            ParticipateAsNode:  "a1314953-8226-44f4-8a3e-e87b09310579",
            RepresentDevices:   "e82456b3-a7d9-4971-9d8c-fd0be4545ab4",
            ReadAllStates:      "8790cf3d-b793-423c-b373-8cfcf9f63529",
            ReadNode:           "046d6603-fa62-4208-9400-65d61f8b1ec4",
            ReadWholeNamespace: "81833dbb-1150-4078-b1db-978c646ba73e",
            UpdateOwnState:     "bdc96a3e-d6fb-48ed-b790-0aa95cf826f0",
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
        ClusterManager:         "2706aa43-a826-441e-9cec-cd3d4ce623c2",
        ConfigDB:               "af15f175-78a0-4e05-97c0-2a0bb82b9f3b",
        CmdEsc:                 "78ea7071-24ac-4916-8351-aa3e549d8ccd",
        Git:                    "7adf4db0-2e7b-4a68-ab9d-376f4c5ce14b",
    },
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
        ClusterManager:         "00000000-0000-0000-0000-000000000000",
        Directory:              "5cc3b068-938f-4bb2-8ceb-64338a02fbeb",
        CmdEsc:                 "00000000-0000-0000-0000-000000000000",
        MQTT:                   "2f42daeb-4521-4522-8e19-85dfb73db88e",
        Git:                    "626df296-8156-4c67-8aed-aac70161aa8b",
        Authentication:         "127cde3c-773a-4f61-b0ba-7412a2695253",
        Manager:                "2340e706-1280-420c-84a6-016547b55e95",
        Files:                  "cb0ac52a-7622-4c75-aa95-ad4c700ae6fb",
    },
    /* XXX These should not be fixed. They should be replaced by
     * per-deployment accounts created by krbkeys, and
     * ServiceRequirement groups to grant them permissions. */
    ServiceAccount: {
        Auth:                   "1e1989ab-14e4-42bd-8171-495230acc406",
        ClusterManager:         "127cde3c-773a-4f61-b0ba-7412a2695253",
        CmdEsc:                 "23d4e8f9-76c0-49d5-addc-00b6ac05ee58",
        ConfigDB:               "36861e8d-9152-40c4-8f08-f51c2d7e3c25",
        Directory:              "5cc3b068-938f-4bb2-8ceb-64338a02fbeb",
        Git:                    "626df296-8156-4c67-8aed-aac70161aa8b",
        KrbKeys:                "a04b4195-7db4-4480-b3f3-4d22c08b96ea",
        Manager:                "2340e706-1280-420c-84a6-016547b55e95",
        MQTT:                   "2f42daeb-4521-4522-8e19-85dfb73db88e",
        Warehouse:              "388ddbdc-4eb4-4ae8-bbd0-9be32f3c31e8",
    },
    Driver: {
        /* Edge Agent internal drivers */
        REST:                   "c9f5c6ac-de4d-11ef-befa-ef66bbfc8926",
        MTConnect:              "e8c74c90-de4d-11ef-ad96-6b885f1e8b5d",
        EtherNetIP:             "eefce570-de4d-11ef-95e6-379190194ffa",
        S7:                     "f171a296-de4d-11ef-aef4-cf4e4ac2bfc6",
        OPCUA:                  "f32fed40-de4d-11ef-a011-1711bd498427",
        MQTT:                   "f4789ae4-de4d-11ef-9de4-ab74010e5ff5",
        Websocket:              "f5fa94ee-de4d-11ef-882f-a7f7c2ad5273",
        UDP:                    "f76120f0-de4d-11ef-baeb-4b617561ae1d",

        /* Stock in-cluster drivers */
        Bacnet:                 "bdc64178-de4c-11ef-b15e-3711aef7cf9b",
        Modbus:                 "c355a44e-de4c-11ef-8a5a-e31f3872ed79",
        Test:                   "c8798cba-de4c-11ef-8a43-8766e8683af8",
        TPlinkSmartPlug:        "d46e1374-de4c-11ef-b469-c388a038fd5c",
        ADS:                    "6764f1e5-fbe7-494c-8dbe-b80039c30c97",

        /* External driver */
        External:               "eb669a2c-e213-11ef-998e-a7fc6f4817b5",
    },
};

/* XXX Most of the UUIDs below here are copied in from elsewhere in ACS.
 * They should be referenced instead, but it's not clear how to achieve
 * that. We can't just `import from "../acs-directory/lib/uuids.js"` as
 * this will not be part of the Docker build context. */

/* XXX Perhaps we need some sort of UUID name registration system? As
 * long as service-client has enough UUIDs to contact the ConfigDB we
 * can store more names in there... This could extend to a Local prefix
 * with per-install UUIDs generated by service-setup. */

export const ConfigDB = {
    Class: {
        Individual:         "2494ae9b-cd87-4c01-98db-437a303b43e9",
        R1Class:            "04a1c90d-2295-4cbe-b33a-74eded62cbf1",
        R2Class:            "705888ce-53fa-434d-afee-274b331d4642",
        R3Class:            "52b80183-6998-4bf9-9b30-132755e7dede",
    },
    Special: {
        Null:               "00000000-0000-0000-0000-000000000000",
        FactoryPlus:        "11ad7b32-1d32-4c4a-b0c9-fa049208939a",
        Self:               "5855a1cc-46d8-4b16-84f8-ab3916ecb230",
        Unowned:            "091e796a-65c0-4080-adff-c3ce01a65b2e",
    },
    Perm: {
        ReadConfig: "4a339562-cd57-408d-9d1a-6529a383ea4b",
        WriteConfig: "6c799ccb-d2ad-4715-a2a7-3c8728d6c0bf",
        ManageAppSchema: "95c7cbcb-ce60-49ed-aa81-2fe3eec4559d",
        ManageObjects: "f0b7917b-d475-4888-9d5a-2af96b3c26b6",
        DeleteObjects: "6957174b-7b08-45ca-ac5c-c03ab6928a6e",
        GiveTo: "4eaab346-4d1e-11f0-800e-dfdc061c6a63",
        TakeFrom: "6ad67652-5009-11f0-9404-73b79124c3d5",
    }
};

export const Auth = {
    Class: {
        PrincipalGroup:     "c0157038-ccff-11ef-a4db-63c6212e998f",
        PrincipalType:      "ae17afe0-ccff-11ef-bb70-67807cb4a9df",
        Role:               "f1fabdd1-de90-4399-b3da-ccf6c2b2c08b",
        ServiceRole:        "b419cbc2-ab0f-4311-bd9e-f0591f7e88cb",
        EdgeRole:           "3ba1d68e-ccf5-11ef-82d9-ef32470538b1",
        ClientRole:         "b2053a3e-bdf8-11ef-9423-771a19e4a8a4",

        Principal:          "11614546-b6d7-11ef-aebd-8fbb45451d7c",
        HumanUser:          "8b3e8f35-78e5-4f93-bf21-7238bcb2ba9d",
        CentralService:     "e463b4ae-a322-46cc-8976-4ba76838e908",
        EdgeService:        "97756c9a-38e6-4238-b78c-3df6f227a6c9",
        EdgeAgent:          "00da3c0b-f62b-4761-a689-39ad0c33f864",
        AppAccount:         "69b0f40a-cd00-11ef-b490-ab964303209d",
        SpecialAccount:     "6c5fda5c-cd02-11ef-b4d4-c7be8081480f",

        PermissionGroup:    "ac0d5288-6136-4ced-a372-325fbbcdd70d",
        ServicePerms:       "b7f0c2f4-ccf5-11ef-be77-777cd4e8cb41",
        CompositePerm:      "1c567e3c-5519-4418-8682-6086f22fbc13",

        Permission:         "8ae784bb-c4b5-4995-9bf6-799b3c7f21ad",
        /* Unused; for future use with auth templates */
        BasePerm:           "02795190-b6d7-11ef-a58e-6b98fe4ed4f9",
        Template:           "0a096ada-b6d7-11ef-8092-233f813c6263",
    },

    App: {
        /* Unused; for future use */
        Template:           "2760634a-b6d7-11ef-b5f5-cfe88d82bd26",
    },
    Perm: {
        ManageKerberos: "327c4cc8-9c46-4e1e-bb6b-257ace37b0f6",
        ReadEffective: "35252562-51e5-4dd8-84cd-ba0fafa62669",
        ManageACL: "3a41f5ce-fc08-4669-9762-ec9e71061168",
        ReadACL: "ba566181-0e8a-405b-b16e-3fb89130fbee",
        ManageGroup: "be9b6d47-c845-49b2-b9d5-d87b83f11c3b",
        ReadKerberos: "e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c",
    },
};

export const MQTT = {
    App: {
        PermTemplate:       "1266ddf1-156c-4266-9808-d6949418b185",
    },
    Perm: {
        ReadNode: "046d6603-fa62-4208-9400-65d61f8b1ec4",
        SubscribeWholeNamespace: "21000098-3a53-48da-8d3e-cc0650603d8e",
        ReadWholeNamespace: "81833dbb-1150-4078-b1db-978c646ba73e",
        IssueCommands: "50f1e694-7e18-4930-aa59-97cc90a6a1ec",
        PublishAllFromGroup: "64c019f8-6754-4270-8917-6659a5628b86",
        ReadAllStates: "8790cf3d-b793-423c-b373-8cfcf9f63529",
        WriteGroupState: "9a32f195-a8cc-4562-a87a-d4653279474f",
        ParticipateAsNode: "a1314953-8226-44f4-8a3e-e87b09310579",
        WriteOwnState: "bdc96a3e-d6fb-48ed-b790-0aa95cf826f0",
        IssueGroupCommands: "cff45682-f2f0-4c72-91f3-7dda20d43509",
        ReadOwnGroup: "d617e37c-3908-41b1-8820-d3f8d41a4280",
        RepresentDevices: "e82456b3-a7d9-4971-9d8c-fd0be4545ab4",
        ReadAllBirths: "67dc4dd0-0939-42b1-b1f9-9049f4d91d40",
    },
};

export const CmdEsc = {
    App: {
        CmdDef: "60e99f28-67fe-4344-a6ab-b1edb8b8e810",
    },
    Perm: {
        Rebirth: "fbb9c25d-386d-4966-a325-f16471d9f7be",
        ReloadEdgeAgentConfig: "6335f100-e68e-4e4d-b46d-85b42f85a036",
    },
}

export const Clusters = {
    App: {
        Bootstrap:          "a807d8fc-63ff-48bb-85c7-82b93beb606e",
        Cluster:            "bdb13634-0b3d-4e38-a065-9d88c12ee78d",
        EdgeStatus:         "747a62c9-1b66-4a2e-8dd9-0b70a91b6b75",
        Flux:               "72804a19-636b-4836-b62b-7ad1476f2b86",
        HelmChart:          "729fe070-5e67-4bc7-94b5-afd75cb42b03",
        HelmRelease:        "88436128-09a3-4c9c-b7f4-b0e495137265",
        HelmTemplate:       "729fe070-5e67-4bc7-94b5-afd75cb42b03",
        Status:             "f6c67e6f-e48e-4f69-b4bb-bfbddcc2a517",
    },
    Class: {
        Cluster:            "f24d354d-abc1-4e32-98e1-0667b3e40b61",
        Account:            "97756c9a-38e6-4238-b78c-3df6f227a6c9",
        HelmChart:          "f9be0334-0ff7-43d3-9d8a-188d3e4d472b",
        SystemHelmChart: "a5c54a2e-8f7b-4b2a-9e8d-3f7c9e7d1c6a",
        ClusterGroups:      "979f7fd9-bbc7-4810-a774-6082c7394db6",
    },
    Service: {
        ClusterManager:     "2706aa43-a826-441e-9cec-cd3d4ce623c2",
    },
    Perm: {
        All:                "9e07fd33-6400-4662-92c4-4dff1f61f990",
        Clusters:           "a40acff8-0c61-4251-bef3-d8d53e50cdd0",
        Secrets:            "07fba27a-0d01-4c07-875b-d25345261d3a",
    },
    Requirement: {
        ServiceAccount:     "26d192cf-73c1-4c14-93cf-1e63743bab08",
        EdgeRepos:          "3a58340c-d4ec-453d-99c3-0cf6ab7d8fa9",
        FluxAccounts:       "4eeb8156-856d-4251-a4a4-4c1b2f3d3e2c",
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
        Connection:         "f371cbfc-de3e-11ef-b361-7b31622bc42f",
        Driver:             "3874e06c-de4a-11ef-a68c-0f1c2d4d555c",
        LinkRelation:       "2bce9142-6b5b-4a5e-8e2f-f8a8d51d6c15",
    },
    Group: {
        EdgeGroup:          "9ba0de4b-056f-4b5e-b966-2d5d85d07767",
        EdgePermission:     "7594cd71-e5b9-4467-88c0-b11a66d47fec",
    },
    App: {
        AgentConfig:        "aac6f843-cfee-4683-b121-6943bfdf9173",
        ClusterStatus:      "747a62c9-1b66-4a2e-8dd9-0b70a91b6b75",
        ConnConfig:         "fa8b429c-de3e-11ef-87fd-6382f0eac944",
        Deployment:         "f2b9417a-ef7f-421f-b387-bb8183a48cdb",
        DriverDef:          "454e5bec-de4a-11ef-bfea-4bc400f636a5",
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
        ClusterManager:     "127cde3c-773a-4f61-b0ba-7412a2695253",
    },
};

export const Files = {
  App: {
    Config: '731cb924-71bb-49fa-8cb8-1584bd1ebad3',
  },
  Class: {
    File: 'b8fae5ab-678e-4d35-802f-2dd8ee3b5b02',
    FileType: '923801b3-c97a-48d8-8af9-da97dc13fe2d',
    FileGroup: 'cd5b941e-f952-4cba-9db5-323b1db80d23',
  },
  Service: {
    Files: 'a2a6efc5-9793-4486-9fd9-7caf9e3b5451',
  },
  FileType: {
    PDF: '291aa8d4-b743-46b2-a883-0fa1c94e419a',
    CAD: 'ff7c1a80-7866-48a7-aa2b-c4beb1878a4b',
    CSV: 'd006b2ab-0df2-4f99-abd9-e15d8c9cd359',
    TXT: '68a241cc-5ea7-45df-a1c4-87a35079795d',
  },
  Perm: {
    All: '09cce2eb-dc82-4a5a-b2ec-bca12f456ab8',
    Upload: '81ed0b6c-7305-4f51-85c5-5c66bdac7920',
    Download: '3b436260-2100-454b-aea5-8f933a1ed7e5',
    ListStorage: 'c9dc7146-3f55-4721-8638-0ab8c7834e72',
  },
  Requirement: {
    ServiceAccount: '1356e8b9-c953-42ac-9ffc-ae26edb88e42',
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
        Manage_Storage: "7fd8a8c1-6050-4950-97bd-a35bb83ff750",
    },
    Requirement: {
        ServiceAccount:     "a461ef62-0560-4be2-8d97-1a56916ce4f8",
    },
};

export const UNS = {
    Group: {
        Sparkplug:  "e414d355-b991-429b-8f5d-97e823ff71f5",
        Historian:  "03f5f08a-f61e-4134-8f66-b2951e3bbb69",

        Ingester:   "e03152b8-cdab-11ef-8ee9-77393064507e",
        Reader:     "d6a4d87c-cd02-11ef-9a87-2f86ebe5ee08",
    },
    Perm: {
        WriteToEntireUNS:   "9fa6ff20-9d2a-4444-960c-40ebcf56f5b4",
        ReadEntireUNS:      "ffa40b36-3a61-4545-832a-2d1e8b860d63",
    },
};
