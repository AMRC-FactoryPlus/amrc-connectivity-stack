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

// Namespace for synthetic v5 UUIDs (metric path segments without an
// Instance_UUID, and the dataset folder / object type).
export const I3X_UUID_NAMESPACE = "11ad7b32-1d32-4c4a-b0c9-fa049208939a";

// Data Access dataset representation in the ConfigDB (see
// acs-data-access/lib/constants.js). Membership of the Dataset class
// plus one structure App entry per dataset type.
export const DATASET_CLASS_UUID           = "c31d3cbd-01cd-4833-8014-c4512aef1e5c";
export const DATASET_APP_SPARKPLUG_SRC    = "f5d550c4-2831-11f1-b0b0-83fda3035799";
export const DATASET_APP_SESSION_LIMITS   = "8754c000-3778-4ae6-b2b8-bbcd959bb775";
export const DATASET_APP_UNION_COMPONENTS = "1c4ca454-de38-44d9-92fb-aa5218bfa257";
