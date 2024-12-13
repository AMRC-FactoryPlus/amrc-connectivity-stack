
/* ACS ConfigDB
 * Schema for dump files
 * Copyright 2024 University of Sheffield AMRC
 */

import { App, Class, Service } from "./constants.js";

export const dump_schema = {
    type: "object",
    required: ["service", "version"],
    properties: {
        service:    { const: Service.Registry },
        version:    { type: "integer" }},
    oneOf: [
        {   type: "object",
            required: ["version"],
            additionalProperties: false,
            properties: {
                service: true,
                version: { const: 1 },
                /* This is ignored but we need to accept it from s-s */
                overwrite: { type: "boolean" },
                classes: {
                    type: "array",
                    items: { type: "string", format: "uuid" }},
                objects: {
                    type: "object",
                    propertyNames: { format: "uuid" },
                    properties: {
                        [Class.Class]: false },
                    additionalProperties: {
                        type: "array",
                        items: { type: "string", format: "uuid" }}},
                configs: {
                    type: "object",
                    properties: {
                        [App.Registration]: false },
                    propertyNames: { format: "uuid" },
                    additionalProperties: {
                        type: "object",
                        propertyNames: { format: "uuid" },
                        additionalProperties: true }}}},
        {   type: "object",
            required: ["version"],
            additionalProperties: false,
            properties: {
                service: true,
                version: { const: 2 },
                objects: {
                    type: "object",
                    propertyNames: { format: "uuid" },
                    additionalProperties: {
                        type: "array",
                        items: { type: "string", format: "uuid" }}},
                configs: {
                    type: "object",
                    properties: {
                        [App.Registration]: false },
                    propertyNames: { format: "uuid" },
                    additionalProperties: {
                        type: "object",
                        propertyNames: { format: "uuid" },
                        additionalProperties: true }}}},
]};
