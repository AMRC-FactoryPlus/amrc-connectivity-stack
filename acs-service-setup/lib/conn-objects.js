/* ACS service setup
 * Connection configuration migration
 * Copyright 2025 University of Sheffield AMRC
 */

import { ServiceError, UUIDs } from "@amrc-factoryplus/service-client";

import { ServiceConfig } from "./service-config.js";
import { ACS, Edge } from "./uuids.js";

const internalDrivers = new Map([
    ["REST", [ACS.Driver.REST, "RESTConnDetails"]],
    ["MTConnect", [ACS.Driver.MTConnect, "MTConnectConnDetails"]],
    ["EtherNet/IP", [ACS.Driver.EtherNetIP, "EtherNetIPConnDetails"]],
    ["S7", [ACS.Driver.S7, "s7ConnDetails"]],
    ["OPC UA", [ACS.Driver.OPCUA, "OPCUAConnDetails"]],
    ["MQTT", [ACS.Driver.MQTT, "MQTTConnDetails"]],
    ["Websocket", [ACS.Driver.Websocket, "WebsocketConnDetails"]],
    ["UDP", [ACS.Driver.UDP, "UDPConnDetails"]],
]);

const stockDrivers = new Map([
    ["bacnet",              ACS.Driver.Bacnet],
    ["modbus",              ACS.Driver.Modbus],
    ["test",                ACS.Driver.Test],
    ["tplink-smartplug",    ACS.Driver.TPlinkSmartPlug],
]);

const { Connection, Driver } = Edge.Class;
const { AgentConfig, ConnConfig, Deployment, DriverDef } = Edge.App;

/* This is to produce a unique identifier. If these
 * default in the Helm chart we omit them here. */
const image_tag = img => `${img.registry}/${img.repository}:${img.tag}`;

class ConnMigration extends ServiceConfig {
    fetch_configs (app) {
        const cdb = this.CDB;
        return cdb.list_configs(app)
            .then(list => Promise.all(
                list.map(u => cdb.get_config(app, u)
                    .then(c => [u, c]))))
            .then(l => new Map(l));
    }

    async register_drivers () {
        this.log("Registering custom external drivers");
        const cdb = this.CDB;
        const { agent } = this.config.helm;

        const drivers = await this.fetch_configs(DriverDef);
        this.drivers = new Map([...drivers.entries()]
            .filter(([u, d]) => d.image)
            .map(([u, d]) => [image_tag(d.image), u]));

        this.deployments = await this.fetch_configs(Deployment);
        for (const d of this.deployments) {
            if (!(d.chart == agent || d.charts?.some(c => c == agent)))
                continue;
            if (!d.values?.image)
                continue;

            for (const image of Object.values(d.values.image)) {
                const tag = image_tag(image);
                if (this.drivers.has(tag))
                    continue;

                const driver = await cdb.create_object(Driver);
                this.log("Registering %s as %s", tag, driver);
                await cdb.put_config(DriverDef, driver, { image });
                this.drivers.set(tag, driver);
            }
        }
    }

    find_driver (conn, dep) {
        if (conn.connType != "Driver") {
            const internal = internalDrivers.get(conn.connType);
            if (!internal)
                throw `Unknown connType '${conn.connType}'`;
            return internal;
        }

        const img = dep.drivers?.[conn.name]?.image;
        if (!img)
            throw `No image specified, can't find driver`;

        if (stockDrivers.has(img) && !(img in dep.image))
            return [stockDrivers.get(img), "DriverDetails"];

        if (!(img in dep.image))
            throw `Undefined image tag '${img}'`;
        const tag = image_tag(dep.image[img]);

        return [this.drivers.get(tag), "DriverDetails"];
    }

    async register_connections () {
        this.log("Registering Edge Agent connections");
        const cdb = this.CDB;

        const configs = await this.fetch_configs(AgentConfig);

        for (const [uuid, config] of configs.entries()) {
            this.log("Migrating connections for %s", uuid);

            const dep = this.deployments.get(uuid);
            if (!dep)
                throw `No Deployment, can't find drivers`;

            for (const conn of config.deviceConnections) {
                if (conn.uuid)
                    continue;

                this.log("  Migrating connection %s", conn.name);

                const [driver, details] = this.find_driver(conn, dep);
                const cconf = {
                    driver,
                    topology: {
                        cluster:    dep.cluster,
                        hostname:   dep.hostname,
                    },
                    deployment: dep.values,
                    config:     conn[details],
                    source: {
                        payloadFormat:  conn.payloadFormat,
                        pollInterval:   conn.pollInt,
                    },
                };

                const cuuid = await cdb.create_object(Connection);
                this.log("  Migrating as %s", cuuid);
                await cdb.put_config(ConnConfig, cuuid, cconf);

                conn.uuid = cuuid;
                /* XXX Properly we should use If-Match */
                cdb.put_config(AgentConfig, uuid, config);
                /* XXX Update Manager */
            }
        }
    }
}

export async function migrate_connections (ss) {
    const { fplus } = ss;

    const res = await fplus.Fetch.fetch({
        service:    ACS.Service.Manager,
        method:     "POST",
        url:        "api/setup/connections",
    });
    if (res[0] != 200)
        throw new ServiceError(ACS.Service.Manager,
            "Connection migration failed", res[0]);

//    const conf = await new ConnMigration({
//        ss,
//        name:       "conns",
//        service:    ACS.Service.Manager,
//    }).init();
//
//    await conf.register_drivers();
//    await conf.register_connections();
}

