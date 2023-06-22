/* ACS Edge Deployment manager
 * UUID constants.
 * Copyright 2023 AMRC.
 */

export const Edge = {
    App: {
        Cluster:    "bdb13634-0b3d-4e38-a065-9d88c12ee78d",
        Template:   "72804a19-636b-4836-b62b-7ad1476f2b86",
        Host:       "c6120703-48ff-46d1-a4fc-037078ea8bfb",
        Agent:      "c6120703-48ff-46d1-a4fc-037078ea8bfb",
    },
    Class: {
        Cluster:    "f24d354d-abc1-4e32-98e1-0667b3e40b61",
        Template:   "f9be0334-0ff7-43d3-9d8a-188d3e4d472b",
        Host:       "f24d354d-abc1-4e32-98e1-0667b3e40b61",
    },
    Service: {
        EdgeDeployment: "2706aa43-a826-441e-9cec-cd3d4ce623c2",
    },
    Perm: {
        All:        "9e07fd33-6400-4662-92c4-4dff1f61f990",
        Clusters:   "a40acff8-0c61-4251-bef3-d8d53e50cdd0",
        Secrets:    "07fba27a-0d01-4c07-875b-d25345261d3a",
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
