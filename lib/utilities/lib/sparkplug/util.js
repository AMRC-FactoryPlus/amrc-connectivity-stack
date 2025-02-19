/* Factory+ directory
 * Sparkplug utilities
 * Copyright 2021 AMRC
 */

/* These functions are a compatibility interface for existing code; I
 * think acs-directory, acs-configdb and acs-cmdesc. Do not use in new
 * code. */

const make_builder = (new_metrics) => {
    return (metrics) => {
        metrics = metrics ?? [];
        metrics.push(...new_metrics);
        return metrics;
    };
};

export const MetricBuilder = {
    birth: {
        /* Standard metrics every Node needs */
        node: make_builder([
            /* XXX always send bdSeq as 0 for now */
            { name: "bdSeq", type: "UInt64", value: 0 },
            { name: "Node Control/Rebirth", type: "Boolean", value: false },
        ]),

        /* Standard metrics every Device needs */
        device: make_builder([
            { name: "Device Control/Rebirth", type: "Boolean", value: false },
        ]),

        /* F+ command escalation metrics */
        command_escalation: make_builder([
            {   name: "Command_Request_Template",
                type: "Template",
                value: {
                    isDefinition: true,
                    version: "",
                    metrics: [
                        { name: "Receivers_Group_ID", type: "String" },
                        { name: "Receivers_Edge_Node_ID", type: "String" },
                        { name: "Receivers_Device_ID", type: "String" },
                        { name: "Tag_Path", type: "String" },
                        { name: "Tag_Value", type: "String" },
                        { name: "Command_Timestamp", type: "DateTime" },
                    ],
                },
            },
            {   name: "Command_Response_Template",
                type: "Template",
                value: {
                    isDefinition: true,
                    version: "",
                    metrics: [
                        { name: "Receivers_Group_ID", type: "String" },
                        { name: "Receivers_Edge_Node_ID", type: "String" },
                        { name: "Receivers_Device_ID", type: "String" },
                        { name: "Tag_Path", type: "String" },
                        { name: "Response", type: "String" },
                        { name: "Command_Timestamp", type: "DateTime" },
                    ],
                },
            },
            {   name: "Execute_Remote_Command",
                type: "Template",
                value: {
                    isDefinition: false,
                    templateRef: "Command_Request_Template",
                    version: "",
                    metrics: [
                        { name: "Receivers_Group_ID", type: "String" },
                        { name: "Receivers_Edge_Node_ID", type: "String" },
                        { name: "Receivers_Device_ID", type: "String" },
                        { name: "Tag_Path", type: "String" },
                        { name: "Tag_Value", type: "String" },
                        { name: "Command_Timestamp", type: "DateTime" },
                    ],
                },
            },
            {   name: "Remote_Command_Response",
                type: "Template",
                value: {
                    isDefinition: false,
                    templateRef: "Command_Response_Template",
                    version: "",
                    metrics: [
                        { name: "Receivers_Group_ID", type: "String" },
                        { name: "Receivers_Edge_Node_ID", type: "String" },
                        { name: "Receivers_Device_ID", type: "String" },
                        { name: "Tag_Path", type: "String" },
                        { name: "Response", type: "String" },
                        { name: "Command_Timestamp", type: "DateTime" },
                    ],
                },
            },
            {   name: "Remote_Command_Response_JSON",
                type: "String",
            },
        ]),
    },

    death: {
        /* Node death certificate */
        node: make_builder([
            /* XXX always send bdSeq as 0 for now */
            { name: "bdSeq", type: "UInt64", value: 0 },
        ]),
    },

    data: {
        command_escalation (addr, metric, value) {
            return [{
                name: "Execute_Remote_Command",
                type: "Template",
                value: {
                    isDefinition: false,
                    templateRef: "Command_Request_Template",
                    version: "",
                    metrics: [
                        { name: "Receivers_Group_ID", type: "String",
                            value: addr.group },
                        { name: "Receivers_Edge_Node_ID", type: "String",
                            value: addr.node },
                        { name: "Receivers_Device_ID", type: "String",
                            value: (addr.device ?? "") },
                        { name: "Tag_Path", type: "String",
                            value: metric },
                        { name: "Tag_Value", type: "String",
                            value: value },
                        { name: "Command_Timestamp", type: "DateTime",
                            value: Date.now() },
                    ],
                },
            }];
        },
    },

    cmd: {
        command_escalation_response (addr, metric, stat) {
            const now = Date.now();
            const resp = 
                (stat == 200 ? "" : "Ignition CCL Check Error: ") + 
                ({
                    200:    "OK",
                    403:    "No permission to execute command.",
                    404:    `Tag delivery error. Tag does not exist: ${metric}`,
                    503:    addr.isDevice()
                                ? "Receiving Device Offline."
                                : "Receiving Node Offline.",
                })[stat];

            return [{
                name: "Remote_Command_Response",
                type: "Template",
                value: {
                    isDefinition: false,
                    templateRef: "Command_Response_Template",
                    version: "",
                    metrics: [
                        { name: "Receivers_Group_ID", type: "String",
                            value: addr.group },
                        { name: "Receivers_Edge_Node_ID", type: "String",
                            value: addr.node },
                        { name: "Receivers_Device_ID", type: "String",
                            value: (addr.device ?? "") },
                        { name: "Tag_Path", type: "String", value: metric },
                        { name: "Response", type: "String", value: resp },
                        { name: "Command_Timestamp", type: "DateTime", value: now },
                    ]
                }
            },
            {
                name: "Remote_Command_Response_JSON",
                type: "string",
                value: JSON.stringify({
                    Receivers_Group_ID: addr.group,
                    Receivers_Edge_Node_ID: addr.node,
                    Receivers_Device_ID: addr.device ?? "",
                    Tag_Path: metric,
                    Response: resp,
                    Command_Timestamp: now,
                }),
            }];
        },
    },
};
