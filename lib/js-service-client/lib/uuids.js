/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

export const Class = {
    App: "d319bd87-f42b-4b66-be4f-f82ff48b93f0",
    Class: "04a1c90d-2295-4cbe-b33a-74eded62cbf1",
    Device: "18773d6d-a70d-443a-b29a-3f1583195290",
    EdgeAgent: "00da3c0b-f62b-4761-a689-39ad0c33f864",
    EdgeAgentConnection: "f371cbfc-de3e-11ef-b361-7b31622bc42f",
    EdgeAgentDriver: "3874e06c-de4a-11ef-a68c-0f1c2d4d555c",
    EdgeCluster: "f24d354d-abc1-4e32-98e1-0667b3e40b61",
    EdgeDeployment: "e6f6a6e6-f6b2-422a-bc86-2dcb417a362a",
    Bridge: "178506d2-af52-4c79-8e5d-4958ae7ddfa9",
    File: 'b8fae5ab-678e-4d35-802f-2dd8ee3b5b02',
    FileType: "923801b3-c97a-48d8-8af9-da97dc13fe2d",
    GitRepo: "d25f2afc-1ab8-4d27-b51b-d02314624e3e",
    GitRepoGroup: "b03d4dfe-7e78-4252-8e62-af594cf316c9",
    HelmChart: "f9be0334-0ff7-43d3-9d8a-188d3e4d472b",
    PermGroup: "ac0d5288-6136-4ced-a372-325fbbcdd70d",
    Permission: "8ae784bb-c4b5-4995-9bf6-799b3c7f21ad",
    Principal: "11614546-b6d7-11ef-aebd-8fbb45451d7c",
    Private: "eda329ca-4e55-4a92-812d-df74993c47e2",
    Requirement: "b419cbc2-ab0f-4311-bd9e-f0591f7e88cb",
    Schema: "83ee28d4-023e-4c2c-ab86-12c24e86372c",
    Service: "265d481f-87a7-4f93-8fc6-53fa64dc11bb",
    Special: "ddb132e4-5cdd-49c8-b9b1-2f35879eab6d",
    SystemHelmChart: "a5c54a2e-8f7b-4b2a-9e8d-3f7c9e7d1c6a",
};

export const Special = {
    Null:           "00000000-0000-0000-0000-000000000000",
    FactoryPlus:    "11ad7b32-1d32-4c4a-b0c9-fa049208939a",
    Self:           "5855a1cc-46d8-4b16-84f8-ab3916ecb230",
    Unowned:        "091e796a-65c0-4080-adff-c3ce01a65b2e",
    Mine:           "724c0316-4cfd-11f0-b355-0b70840faae8",
};

/* back-compat */
export const Null = Special.Null;
export const FactoryPlus = Special.FactoryPlus;


export const App = {
    Registration: "cb40bed5-49ad-4443-a7f5-08c75009da8f",
    Info: "64a8bfa9-7772-45c4-9d1a-9e6290690957",
    SparkplugAddress: "8e32801b-f35a-4cbf-a5c3-2af64d3debd7",
    ConfigSchema: "dbd8a535-52ba-4f6e-b4f8-9b71aefe09d3",
    GitRepositoryConfig: "38d62a93-b6b4-4f63-bad4-d433e3eaff29",
    ServiceConfig: "5b47881c-b012-4040-945c-eacafca539b2",
    EdgeAgentConfig: "aac6f843-cfee-4683-b121-6943bfdf9173",
    EdgeAgentDeployment: "f2b9417a-ef7f-421f-b387-bb8183a48cdb",
    EdgeClusterStatus: "747a62c9-1b66-4a2e-8dd9-0b70a91b6b75",
    EdgeClusterSetupStatus: "f6c67e6f-e48e-4f69-b4bb-bfbddcc2a517",
    EdgeClusterConfiguration: "bdb13634-0b3d-4e38-a065-9d88c12ee78d",
    HelmChartTemplate: "729fe070-5e67-4bc7-94b5-afd75cb42b03",
    DeviceInformation: "a98ffed5-c613-4e70-bfd3-efeee250ade5",
    DriverDefinition: "454e5bec-de4a-11ef-bfea-4bc400f636a5",
    ConnectionConfiguration: "fa8b429c-de3e-11ef-87fd-6382f0eac944",
    SchemaInformation: "32093857-9d29-470e-a897-d2b56d5aa978",
    Schema: "b16e85fb-53c2-49f9-8d83-cdf6763304ba",
    ServiceSetup: "5b47881c-b012-4040-945c-eacafca539b2",
    FilesConfig: "731cb924-71bb-49fa-8cb8-1584bd1ebad3",
};

export const Schema = {
    Device_Information: "2dd093e9-1450-44c5-be8c-c0d78e48219b",
    Service: "05688a03-730e-4cda-9932-172e2c62e45c",
};

export const Service = {
    Directory: "af4a1d66-e6f7-43c4-8a67-0fa3be2b1cf9",
    ConfigDB: "af15f175-78a0-4e05-97c0-2a0bb82b9f3b",
    /* Compatibility. This was a failed attempt to rename the service. */
    Registry: "af15f175-78a0-4e05-97c0-2a0bb82b9f3b",
    Auth: "cab2642a-f7d9-42e5-8845-8f35affe1fd4",
    /* Compatibility. This is no longer an authentication service. */
    Authentication: "cab2642a-f7d9-42e5-8845-8f35affe1fd4",
    Command_Escalation: "78ea7071-24ac-4916-8351-aa3e549d8ccd",
    MQTT: "feb27ba3-bd2c-4916-9269-79a61ebc4a47",
    Git: "7adf4db0-2e7b-4a68-ab9d-376f4c5ce14b",
    Clusters: "2706aa43-a826-441e-9cec-cd3d4ce623c2",
    Manager: "619eecab-742d-4824-8b97-bcae472e5c04",
    Files: 'a2a6efc5-9793-4486-9fd9-7caf9e3b5451',
};

/* This list is not meant to be exhaustive, but these are commonly used
 * well-known permissions. */
export const Permission = {
    Auth: {
        ReadACL:            "ba566181-0e8a-405b-b16e-3fb89130fbee",
        ManageKerberos:     "327c4cc8-9c46-4e1e-bb6b-257ace37b0f6",
        ManageACL:          "3a41f5ce-fc08-4669-9762-ec9e71061168",
        ManageGroup:        "be9b6d47-c845-49b2-b9d5-d87b83f11c3b",
    },
    CmdEsc: {
        Rebirth:            "fbb9c25d-386d-4966-a325-f16471d9f7be",
    },
    ConfigDB: {
        ReadConfig:         "4a339562-cd57-408d-9d1a-6529a383ea4b",
        WriteConfig:        "6c799ccb-d2ad-4715-a2a7-3c8728d6c0bf",
        ManageObjects:      "f0b7917b-d475-4888-9d5a-2af96b3c26b6",
    },
    Directory: {
        AdvertiseService:   "4db4c39a-f18d-4e83-aeb0-5af2c14ddc2b",
    },
};

export const Group = {
    UNS_Ingester: "e03152b8-cdab-11ef-8ee9-77393064507e",
};
