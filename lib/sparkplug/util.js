/* Factory+ directory
 * Sparkplug utilities
 * Copyright 2021 AMRC
 */
export class Address {
    constructor (group, node, device) {
        this.group = group;
        this.node = node;

        if (device == null || device == "")
            device = undefined;
        this.device = device;
    }

    static parse (addr) {
        return new Address(...addr.split("/"));
    }

    equals (other) {
        return this.group === other.group && 
            this.node === other.node &&
            this.device === other.device;
    }

    /* Checks for a match, allowing this address to be a wildcard. The
     * other address must be literal. The only wildcard is '+', which
     * allows any string (but not no string at all). */
    matches (other) {
        const wild = (p, a) => 
            p === a || 
            (p == "+" && a != undefined);

        return wild(this.group, other.group) &&
            wild(this.node, other.node) &&
            wild(this.device, other.device);
    }

    toString () {
        let node = `${this.group}/${this.node}`; 
        return this.isDevice() ? `${node}/${this.device}` : node;
    }

    isDevice () { return this.device != undefined; }
    topicKind () { return this.isDevice() ? "D" : "N" }

    topic (type) {
        return new Topic(this, type).toString();
    }

    parent_node () {
        return new Address(this.group, this.node);
    }

    child_device (device) {
        return new Address(this.group, this.node, device);
    }

    is_child_of (node) {
        return this.parent_node().equals(node);
    }
}

export class Topic {
    static prefix = "spBv1.0";

    constructor (address, type) {
        this.address = address;
        this.type = type;
    }

    static parse (topic) {
        const parts = topic.split("/");

        if (parts.length != 4 && parts.length != 5)
            return null;
        if (parts[0] != Topic.prefix)
            return null;

        const addr = new Address(parts[1], parts[3], parts[4]);
        const [, kind, type] = parts[2].match(/(.)(.*)/);

        if (kind != addr.topicKind())
            return null;

        return new Topic(addr, type);
    }

    toString () {
        const a = this.address;
        const t = this.type;
        const typ = 
            t == "+" ? t : a.topicKind() + t;

        const node = `${Topic.prefix}/${a.group}/${typ}/${a.node}`;
        return a.isDevice() ? `${node}/${a.device}` : node;
    }
}

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

export class MetricBranch {
}

export class MetricTree {
    constructor (payload) {
        for (const m of payload.metrics) {
            const path = m.name.split("/");
            const name = path.pop();

            let obj = this;
            for (const p of path) {
                obj = obj[p] ||= new MetricBranch();

                if (!(obj instanceof MetricBranch)) {
                    const branch = new MetricBranch();
                    branch.$metric = obj;
                    obj = branch;
                }
            }
            obj[name] = m;
        }
    }
}
