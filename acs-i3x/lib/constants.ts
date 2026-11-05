export const Version = "0.1.0";
export const I3X_SPEC_VERSION = "0.1.0";

export const HIERARCHY_SCHEMA_UUID = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";
export const DEVICE_INFO_SCHEMA_UUID = "2dd093e9-1450-44c5-be8c-c0d78e48219b";

// Built-in i3X relationship type IDs (synthetic, internal to this service)
export const RelType = {
    HasParent:     "i3x:rel:has-parent",
    HasChildren:   "i3x:rel:has-children",
    HasComponent:  "i3x:rel:has-component",
    ComponentOf:   "i3x:rel:component-of",
};

// ConfigDB UUIDs consumed by the object tree loader and notify subscriptions.
export const DEVICE_CLASS_UUID            = "18773d6d-a70d-443a-b29a-3f1583195290";
export const SCHEMA_APP_UUID              = "b16e85fb-53c2-49f9-8d83-cdf6763304ba";
export const INFO_APP_UUID                = "64a8bfa9-7772-45c4-9d1a-9e6290690957";
export const DEVICE_INFORMATION_APP_UUID  = "a98ffed5-c613-4e70-bfd3-efeee250ade5";

// ISA-95 vocabulary: every node is a member of ISA95_LEVEL_CLASS_UUID,
// the top-level nodes of ISA95_ENTERPRISE_CLASS_UUID.
export const ISA95_LEVEL_CLASS_UUID       = "3866b165-6b31-46e3-a801-cb367e04e726";
export const ISA95_ENTERPRISE_CLASS_UUID  = "2980293e-4a82-49a3-b121-9a8fa109d0a8";
export const ISA95_VOCABULARY_APP_UUID    = "11096075-acc6-4eae-b682-9b27d776384d";
// The level classes, by level name.
export const ISA95_LEVEL_CLASSES: Record<string, string> = {
    "Enterprise":   "2980293e-4a82-49a3-b121-9a8fa109d0a8",
    "Site":         "70a948a7-7d99-400c-896a-ae63ab4362e0",
    "Area":         "d0ac7371-41d6-45b2-8a42-781f8d4c8d54",
    "Work Center":  "b0633e7c-e0c1-4350-9f86-72b83e3e9cb0",
    "Work Unit":    "00074ce8-2142-40a6-aff3-1057a83ddad2",
};
// Each device's place in the vocabulary: { node, instances? }.
export const ISA95_PLACEMENT_APP_UUID     = "f9345c57-14e3-4027-b76d-2b0b67eb8fed";

// i3X permissions (acs-service-setup/dumps/i3x.yaml).
export const Perm = {
    ReadObject:    "d24495fd-72a3-41cd-8b9f-f4ebabdade44",
};
// The wildcard target: a grant on it covers every target.
export const NULL_UUID = "00000000-0000-0000-0000-000000000000";
