/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * UUID constants
 * Copyright 2022 AMRC
 */

export const Class = {
    Principal:      "11614546-b6d7-11ef-aebd-8fbb45451d7c",
    Permission:     "8ae784bb-c4b5-4995-9bf6-799b3c7f21ad",
};

export const Perm = {
    All:            "50b727d4-3faa-40dc-b347-01c99a226c58",
    ReadACL:        "ba566181-0e8a-405b-b16e-3fb89130fbee",
    WriteACL:       "3a41f5ce-fc08-4669-9762-ec9e71061168",

    /* XXX These are tricky: currently I need separate sets of
     * permissions for each ID type. For now only support Kerberos. */
    ReadKrb:        "e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c",
    WriteKrb:       "327c4cc8-9c46-4e1e-bb6b-257ace37b0f6",

    /* This is only for migration */
    ManageGroup:    "be9b6d47-c845-49b2-b9d5-d87b83f11c3b",
};

export const Special = {
    Wildcard:       "00000000-0000-0000-0000-000000000000",
    Self:           "5855a1cc-46d8-4b16-84f8-ab3916ecb230",
    Unowned:        "091e796a-65c0-4080-adff-c3ce01a65b2e",
    Mine:           "724c0316-4cfd-11f0-b355-0b70840faae8",
};

export const IdKind = {
    Kerberos:          "75556036-ce98-11ef-9534-637ef5d37456",
    Sparkplug:         "7c51a61a-ce98-11ef-834a-976fb7c5dd4c",
};
