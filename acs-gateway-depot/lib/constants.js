/*
 * ACS Gateway Depot
 * UUIDs and other constants.
 * Copyright 2026 University of Sheffield AMRC
 */

/* These must match acs-service-setup/lib/uuids.js. */

export const Service = {
    GatewayDepot:   "4e298f74-4ae9-4da6-ba80-7a08de4036a6",
    Clusters:       "2706aa43-a826-441e-9cec-cd3d4ce623c2",
    Manager:        "619eecab-742d-4824-8b97-bcae472e5c04",
};

export const Class = {
    /* Every approved gateway is an object of this class. */
    Gateway:        "e763cbcd-157c-40d5-8e54-87c0647d9e07",
    EdgeCluster:    "f24d354d-abc1-4e32-98e1-0667b3e40b61",
};

export const App = {
    /* The record of a gateway: hardware, settings, state, history. */
    Gateway:        "a67ed556-80e0-43d2-bd6e-3d25122b9a80",
    /* What only this service needs: hashes of the gateway's secret and
     * of its admin password. */
    Private:        "90b6d8ce-d5e3-4c9e-afde-624f93d893b4",

    Info:           "64a8bfa9-7772-45c4-9d1a-9e6290690957",
    ServiceConfig:  "5b47881c-b012-4040-945c-eacafca539b2",
    ClusterConfig:  "bdb13634-0b3d-4e38-a065-9d88c12ee78d",
    ClusterStatus:  "747a62c9-1b66-4a2e-8dd9-0b70a91b6b75",
};

export const Perm = {
    All:            "eff45a46-11a4-4a99-8429-416ed2a56ce5",
    Provision:      "f8a2ad0a-6a2f-4b1a-b8fe-958e7b01fd94",
};

export const Special = {
    Null:           "00000000-0000-0000-0000-000000000000",
};

/* The namespace the Admin UI gives every edge cluster. */
export const EDGE_NAMESPACE = "fplus-edge";

/* What a gateway is doing, in the order it normally happens. */
export const State = {
    Pending:    "pending",      /* scout running, waiting for approval */
    Approved:   "approved",     /* settings chosen, not collected yet */
    Installing: "installing",   /* Ubuntu is being installed */
    Installed:  "installed",    /* installed and powered off */
    Ready:      "ready",        /* booted and configured, no cluster yet */
    Onboarding: "onboarding",   /* creating or joining a cluster */
    Onboarded:  "onboarded",
    Failed:     "failed",
    Replaced:   "replaced",     /* another gateway has taken its place */
};
