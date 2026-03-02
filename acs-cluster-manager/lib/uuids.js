/* ACS Edge Deployment manager
 * UUID constants.
 * Copyright 2023 AMRC.
 */

export const Edge = {
    App: {
        Cluster:        "bdb13634-0b3d-4e38-a065-9d88c12ee78d",
        Status:         "f6c67e6f-e48e-4f69-b4bb-bfbddcc2a517",
        EdgeStatus:     "747a62c9-1b66-4a2e-8dd9-0b70a91b6b75",
        Flux:           "72804a19-636b-4836-b62b-7ad1476f2b86",
        HelmChart:      "729fe070-5e67-4bc7-94b5-afd75cb42b03",
        K8sTemplate:    "88436128-09a3-4c9c-b7f4-b0e495137265",
        Bootstrap:      "a807d8fc-63ff-48bb-85c7-82b93beb606e",
    },
    Class: {
        Cluster:    "f24d354d-abc1-4e32-98e1-0667b3e40b61",
        Host:       "f24d354d-abc1-4e32-98e1-0667b3e40b61",
        Account:    "97756c9a-38e6-4238-b78c-3df6f227a6c9",
    },
    Service: {
        EdgeDeployment: "2706aa43-a826-441e-9cec-cd3d4ce623c2",
    },
    Perm: {
        All:        "9e07fd33-6400-4662-92c4-4dff1f61f990",
        Clusters:   "a40acff8-0c61-4251-bef3-d8d53e50cdd0",
        Secrets:    "07fba27a-0d01-4c07-875b-d25345261d3a",
    },
    Resource: {
        GitRepo:        "03827afc-d4dc-11f0-9645-dfc5bcb16bc6",
        HelmRelease:    "0c92f608-d4dc-11f0-b2a0-1bc42be2ebc8",
    },
    Requirement: {
        ServiceAccount: "26d192cf-73c1-4c14-93cf-1e63743bab08",
        EdgeRepos:      "3a58340c-d4ec-453d-99c3-0cf6ab7d8fa9",
        Groups:         "979f7fd9-bbc7-4810-a774-6082c7394db6",
        FluxAccounts:   "4eeb8156-856d-4251-a4a4-4c1b2f3d3e2c",
        FluxRoles:      "8cd08563-7c3c-44fd-af4d-15c0fa6dadcb",
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
