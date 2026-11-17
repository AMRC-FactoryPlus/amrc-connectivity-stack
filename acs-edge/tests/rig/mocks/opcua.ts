/*
 * ACS Edge Agent
 * Split-driver cluster rig: a mock OPC UA server
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import os from "os";
import path from "path";

import {
    MessageSecurityMode, OPCUACertificateManager, OPCUAServer, resolveNodeId,
    SecurityPolicy, UAVariable,
} from "node-opcua";

import type { Fixture, OpcuaEvent } from "../../fixtures/drivers/fixture.js";
import { variant } from "../../golden/devices/opcua.js";
import type { RigConnection } from "../rig.js";
import { Looper, Mock, MockStatus, record_write } from "./mock.js";

/* A connection's security mode and policy as node-opcua's, by the
 * names the connection form uses. The built-in OPC UA connection had
 * these, and went in ACS 7. */
function security_mode (name: string): MessageSecurityMode {
    return (MessageSecurityMode as any)[name] ?? MessageSecurityMode.Invalid;
}

function security_policy (name: string): SecurityPolicy {
    if (name == "Aes128_Sha256") return SecurityPolicy.Aes128_Sha256_RsaOaep;
    return (SecurityPolicy as any)[name] ?? SecurityPolicy.Invalid;
}

/* A node-opcua server with one writable variable per node the
 * connection reads, with the fixture's data types.
 *
 * It offers only the security mode and policy the connection is
 * configured with, so a client that quietly fell back to no security
 * could not connect. If the connection uses credentials it accepts
 * only the rig's username and password, and refuses anonymous
 * sessions. It trusts any client certificate, as a server that has
 * been told to trust the Edge Agent's would: whether a real server
 * trusts the split driver's new certificate is not something a mock
 * can show.
 *
 * A connection that logs in on a None endpoint is offered Basic256Sha256
 * as well, because node-opcua offers a username token on a None
 * endpoint only with an encrypting policy the server has. The password
 * is then encrypted with the server's certificate, as real servers set
 * up this way do. Without it no client could log in. */
export class OpcuaMock implements Mock {
    conn:       RigConnection
    fixture:    Fixture
    looper:     Looper<OpcuaEvent>
    /* The host name the server puts in its endpoint URLs. */
    advertise:  string
    server?:    OPCUAServer
    pki:        string
    vars:       Map<string, UAVariable> = new Map()
    delivered = 0
    refused = 0
    writes:     NonNullable<MockStatus["writes"]> = []
    #applying = false

    constructor (conn: RigConnection, fixture: Fixture, opts: { advertise?: string } = {}) {
        this.conn = conn;
        this.fixture = fixture;
        this.advertise = opts.advertise ?? os.hostname();
        this.looper = new Looper(fixture, fixture.events
            .filter((e): e is OpcuaEvent => e.type == "opcua"));
        this.pki = fs.mkdtempSync(path.join(os.tmpdir(), `rig-opcua-${conn.id}-`));
    }

    async start () {
        if (this.server) return;
        const src = this.conn.connection.OPCUAConnDetails ?? {};
        const mode = security_mode(src.securityMode ?? "None");
        const policy = security_policy(src.securityPolicy ?? "None");
        const creds = !!src.useCredentials;

        const certs = new OPCUACertificateManager({
            rootFolder: path.join(this.pki, "server"),
            automaticallyAcceptUnknownCertificate: true,
        });
        const server = new OPCUAServer({
            port:               this.conn.port,
            hostname:           this.advertise,
            securityModes:      [mode],
            securityPolicies:   creds && policy == SecurityPolicy.None
                ? [policy, SecurityPolicy.Basic256Sha256] : [policy],
            allowAnonymous:     !creds,
            userManager: {
                isValidUser: (user: string, password: string) => {
                    const ok = user == this.conn.username
                        && password == this.conn.password;
                    if (!ok) this.refused++;
                    return ok;
                },
            },
            serverCertificateManager: certs,
            maxConnectionsPerEndpoint: 20,
        } as any);
        await server.initialize();
        this.build(server);
        await server.start();
        this.server = server;
        this.looper.start(ev => this.apply(ev));
    }

    build (server: OPCUAServer) {
        const space = server.engine.addressSpace!;
        const first = this.looper.events[0]?.values ?? {};
        this.vars.clear();
        for (const [id, v] of Object.entries(first)) {
            const node = resolveNodeId(id);
            while (space.getNamespaceArray().length <= node.namespace)
                space.registerNamespace(`urn:acs-rig:ns${space.getNamespaceArray().length}`);
            const ns = space.getNamespace(node.namespace);
            const uav = ns.addVariable({
                organizedBy:    space.rootFolder.objects,
                browseName:     id,
                nodeId:         id,
                dataType:       v.dataType,
                accessLevel:    "CurrentRead | CurrentWrite",
                userAccessLevel: "CurrentRead | CurrentWrite",
                minimumSamplingInterval: 0,
            });
            uav.setValueFromSource(variant(v));
            uav.on("value_changed", dv => {
                if (!this.#applying)
                    record_write(this.writes, id, dv.value?.value);
            });
            this.vars.set(id, uav);
        }
    }

    apply (ev: OpcuaEvent) {
        this.#applying = true;
        try {
            for (const [id, v] of Object.entries(ev.values))
                this.vars.get(id)?.setValueFromSource(variant(v));
        }
        finally {
            this.#applying = false;
        }
        this.delivered++;
    }

    async stop () {
        await this.looper.stop();
        const server = this.server;
        this.server = undefined;
        await server?.shutdown(0);
    }

    status (): MockStatus {
        return {
            id: this.conn.id, protocol: this.conn.protocol,
            name: this.conn.name, port: this.conn.port,
            running: !!this.server, delivered: this.delivered,
            clients: this.server?.currentSessionCount ?? 0,
            refused: this.refused,
            writes: this.writes,
        };
    }
}
