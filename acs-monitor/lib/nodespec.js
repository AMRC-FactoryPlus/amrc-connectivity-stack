/*
 * ACS Edge Monitor
 * Node monitor class
 * Copyright 2023 AMRC
 */

import * as imm     from "immutable";

import { NodeMonitor }      from "./monitor/node.js";
import { AgentMonitor }     from "./monitor/agent.js";

export class NodeSpec extends imm.Record({
    uuid:       null, 
    address:    null,
    edgeAgent:  false,
    interval:   "3m",
    secrets:    imm.Set(),
}) {
    static of (spec) {
        return new NodeSpec({
            ...spec,
            secrets:    imm.Set(spec.secrets ?? []),
        });
    }

    monitor (op) {
        const Klass = this.edgeAgent ? AgentMonitor : NodeMonitor;
        return new Klass(op, this);
    }
}
