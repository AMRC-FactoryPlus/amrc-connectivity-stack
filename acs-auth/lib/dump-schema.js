/* ACS Auth service
 * JSON Schema for dump files
 * Copyright 2025 University of Sheffield AMRC
 */

/* This schema only supports v2 dumps, as the current Auth service only
 * supports v2 dumps. It isn't possible to load a v1 dump as the
 * `plural` field cannot be guessed. */

import { UUIDs } from "@amrc-factoryplus/service-client";

export const dump_schema = {
    type: "object",
    required: ["service", "version"],
    properties: {
        service:    { const: UUIDs.Service.Authentication },
        version:    { type: "integer" }},
    oneOf: [
        {   type: "object",
            required: ["version"],
            additionalProperties: false,
            properties: {
                service: true,
                version: { const: 2 },
                identities: {
                    type: "object",
                    propertyNames: { format: "uuid" },
                    additionalProperties: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            kerberos: {
                                type: "string"}}}},
                grants: {
                    type: "array",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["principal", "permission", "target"],
                        properties: {
                            principal:  { type: "string", format: "uuid" },
                            permission: { type: "string", format: "uuid" },
                            target:     { type: "string", format: "uuid" },
                            plural:     { type: "boolean" }}}}}},
]};
