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
