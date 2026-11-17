/*
 * ACS Edge Agent
 * Split-driver cluster rig: create and delete the rig's ACS objects
 * Copyright 2026 University of Sheffield
 *
 * `load()` and `remove()` take a service client, so a test can run
 * them against a ConfigDB of its own. load.ts and remove.ts are their
 * commands, and their headers say what each writes.
 */

import {
    App, BuiltIn, Class, Service, Writer, conn_uuid, device_uuid,
    find_cluster, k8s_name, node_uuid, secret_name, service_client,
} from "./acs.js";
import {
    Rig, RigConnection, device_ids, details_key, manager_config,
    mock_service, node_connections, origin_map, rig_entry,
} from "./rig.js";

/* The connection entry as the loader writes it into the cluster. */
export function cluster_entry (rig: Rig, c: RigConnection) {
    const devices = Object.fromEntries(device_ids(c)
        .map(d => [d, device_uuid(rig, c, d)]));
    return rig_entry(c, {
        host:       `${mock_service(c.protocol)}.${rig.namespace}.svc.cluster.local`,
        password:   c => c.secret,
        uuid:       conn_uuid(rig, c),
        devices,
    });
}

export interface LoadOpts {
    cluster?:   string,
    hostname?:  string,
    dry:        boolean,
}

export async function load (rig: Rig, opts: LoadOpts, client?: any) {
    const fplus = client ?? await service_client();
    const cdb = fplus.ConfigDB;
    const w = new Writer(opts.dry);

    const cluster = await find_cluster(cdb, opts.cluster);
    const namespace = cluster.conf?.namespace;
    if (!namespace) throw new Error(`Edge cluster ${cluster.uuid} has no namespace`);
    const manager = await cdb.get_config(App.ServiceConfig, Service.Manager);
    const chart = manager?.helm?.agent;
    if (!chart) throw new Error("The Manager's service config has no helm.agent chart");
    console.log("Edge cluster %s (namespace %s), Edge Agent chart %s",
        cluster.uuid, namespace, chart);

    let skipped = 0;
    for (const node of rig.nodes) {
        const nuuid = node_uuid(rig, node.name);
        const conns = node_connections(rig, node.name);
        console.log("\n%s (%s): %d connections", node.name, nuuid, conns.length);

        await w.do(`create Edge Agent ${nuuid} and name it ${node.name}`, async () => {
            await cdb.create_object(Class.EdgeAgent, nuuid);
            await cdb.put_config(App.Info, nuuid, { name: node.name });
        });

        const entries: any[] = [];
        for (const c of conns) {
            const cuuid = conn_uuid(rig, c);
            const entry = cluster_entry(rig, c);
            entries.push(entry);

            const cconf = await cdb.get_config(App.ConnectionConfiguration, cuuid);
            if (cconf && cconf.driver != BuiltIn[c.protocol]) {
                console.log("Connection %s has moved to driver %s; leaving it alone",
                    c.name, cconf.driver);
                skipped++;
                continue;
            }

            if (c.secret)
                await w.do(`seal the password of ${c.name} as ${c.secret}`, async () => {
                    const res = await fplus.Fetch.fetch({
                        service: Service.Clusters,
                        url: `v1/cluster/${cluster.uuid}/secret/${namespace}/${secret_name(nuuid)}/${c.secret}`,
                        method: "PUT",
                        body: c.password,
                        headers: { "Content-Type": "application/octet-stream" },
                    });
                    if (!res.ok) throw new Error(`Sealing ${c.secret} failed: ${res.status}`);
                });

            const pollInt = entry.pollInt;
            const config = {
                createdAt:  cconf?.createdAt ?? new Date().toISOString(),
                config:     manager_config(entry, c.protocol),
                deployment: {},
                driver:     BuiltIn[c.protocol],
                edgeAgent:  nuuid,
                ...(pollInt != undefined ? { pollInt } : {}),
                source:     { payloadFormat: entry.payloadFormat },
                topology:   { cluster: cluster.uuid, hostname: opts.hostname ?? null },
            };
            await w.do(`create ${c.protocol} connection ${cuuid} ${c.name} -> ${entry[details_key(c.protocol)].endpoint
                ?? entry[details_key(c.protocol)].baseURL
                ?? `${entry[details_key(c.protocol)].host ?? ""}:${entry[details_key(c.protocol)].port}`}`,
            async () => {
                await cdb.create_object(Class.EdgeAgentConnection, cuuid);
                await cdb.put_config(App.Info, cuuid, { name: c.name, k8s_name: k8s_name(c.name) });
                await cdb.put_config(App.ConnectionConfiguration, cuuid, config);
            });

            for (const dev of device_ids(c)) {
                const duuid = device_uuid(rig, c, dev);
                const info = await cdb.get_config(App.DeviceInformation, duuid);
                const tags = entry.devices?.find((d: any) => d.deviceId == dev)?.tags ?? [];
                const map = origin_map(tags);
                await w.do(`create device ${duuid} ${dev}`, async () => {
                    await cdb.create_object(Class.Device, duuid);
                    await cdb.put_config(App.Info, duuid, { name: `${rig.prefix}-${dev}` });
                    await cdb.put_config(App.DeviceInformation, duuid, {
                        sparkplugName:  dev,
                        schema:         map.Schema_UUID ?? null,
                        connection:     cuuid,
                        node:           nuuid,
                        originMap:      map,
                        createdAt:      info?.createdAt ?? new Date().toISOString(),
                    });
                });
            }
        }

        const current = await cdb.get_config(App.EdgeAgentConfig, nuuid);
        if (current?.deviceConnections?.some((e: any) => e.connType == "Driver")) {
            console.log("%s already has split driver connections; leaving its config alone", node.name);
            skipped++;
        }
        else
            await w.do(`write the Edge Agent config of ${node.name}`, () =>
                cdb.put_config(App.EdgeAgentConfig, nuuid, {
                    sparkplug:          node.sparkplug ?? {},
                    deviceConnections:  entries,
                }));

        const deployment = await cdb.get_config(App.EdgeAgentDeployment, nuuid);
        if (deployment)
            console.log("%s is already deployed; leaving its deployment alone", node.name);
        else {
            const pin = conns.some(c => c.protocol == "UDP") ? opts.hostname : undefined;
            const limits = node.values?.limits;
            const image = node.values?.image?.default?.tag;
            await w.do(`deploy ${node.name} on cluster ${cluster.uuid}${pin ? ` pinned to ${pin}` : ""}`
                + (limits ? `, requesting ${limits.cpu} CPU and ${limits.memory} memory` : "")
                + (image ? `, with its image pinned to ${image}` : ""), () =>
                cdb.put_config(App.EdgeAgentDeployment, nuuid, {
                    createdAt:  new Date().toISOString(),
                    name:       node.name,
                    cluster:    cluster.uuid,
                    chart,
                    ...(pin ? { hostname: pin } : {}),
                    ...(node.values ? { values: node.values } : {}),
                }));
        }
    }

    console.log("\n%d writes %s; %d things left alone because they have moved",
        w.writes, opts.dry ? "would be made (dry run: rerun with --yes)" : "made", skipped);
    return { writes: w.writes, skipped };
}

async function gone (fn: () => Promise<any>) {
    try { await fn(); }
    catch (e: any) {
        if (e?.status != 404) throw e;
    }
}

export async function remove (rig: Rig, opts: { cluster?: string, dry: boolean },
    client?: any)
{
    const fplus = client ?? await service_client();
    const cdb = fplus.ConfigDB;
    const w = new Writer(opts.dry);

    /* The rig's agents: by UUID, and by deployment name. */
    const deployments: Map<string, any> = await cdb.get_all_configs(App.EdgeAgentDeployment);
    const nodes = new Map<string, string>();
    for (const n of rig.nodes) nodes.set(node_uuid(rig, n.name), n.name);
    for (const [uuid, dep] of deployments)
        if (typeof dep?.name == "string" && dep.name.startsWith(`${rig.prefix}_`))
            nodes.set(uuid, dep.name);

    const cconfs: Map<string, any> = await cdb.get_all_configs(App.ConnectionConfiguration);
    const devinfo: Map<string, any> = await cdb.get_all_configs(App.DeviceInformation);
    const conns = [...cconfs].filter(([, c]) => nodes.has(c?.edgeAgent));
    const devices = [...devinfo].filter(([, d]) => nodes.has(d?.node));
    console.log("%d Edge Agents, %d connections, %d devices",
        nodes.size, conns.length, devices.length);

    for (const [uuid, name] of nodes)
        if (deployments.has(uuid))
            await w.do(`undeploy ${name} (${uuid})`, () =>
                gone(() => cdb.delete_config(App.EdgeAgentDeployment, uuid)));

    const secrets = rig.connections.filter(c => c.secret);
    if (secrets.length) {
        const cluster = await find_cluster(cdb, opts.cluster);
        const namespace = cluster.conf?.namespace;
        for (const c of secrets) {
            const nuuid = node_uuid(rig, c.node);
            await w.do(`remove the sealed password of ${c.name}`, async () => {
                const res = await fplus.Fetch.fetch({
                    service: Service.Clusters,
                    url: `v1/cluster/${cluster.uuid}/secret/${namespace}/${secret_name(nuuid)}/${c.secret}`,
                    method: "DELETE",
                });
                if (!res.ok && res.status != 404)
                    throw new Error(`Removing ${c.secret} failed: ${res.status}`);
            });
        }
    }

    for (const [uuid, name] of nodes)
        await w.do(`delete the Edge Agent config of ${name}`, () =>
            gone(() => cdb.delete_config(App.EdgeAgentConfig, uuid)));

    for (const [uuid, d] of devices)
        await w.do(`delete device ${d.sparkplugName} (${uuid})`, async () => {
            await gone(() => cdb.delete_config(App.DeviceInformation, uuid));
            await gone(() => cdb.delete_config(App.ISA95Placement, uuid));
            await gone(() => cdb.delete_config(App.Info, uuid));
            await gone(() => cdb.delete_object(uuid));
        });

    for (const [uuid] of conns)
        await w.do(`delete connection ${uuid}`, async () => {
            await gone(() => cdb.delete_config(App.ConnectionConfiguration, uuid));
            await gone(() => cdb.delete_config(App.Info, uuid));
            await gone(() => cdb.delete_object(uuid));
        });

    for (const [uuid, name] of nodes)
        await w.do(`delete Edge Agent ${name} (${uuid})`, async () => {
            await gone(() => cdb.delete_config(App.SparkplugAddress, uuid));
            await gone(() => cdb.delete_config(App.Info, uuid));
            await gone(() => cdb.delete_object(uuid));
        });

    console.log("\n%d deletions %s", w.writes,
        w.dry ? "would be made (dry run: rerun with --yes)" : "made");
    return { deletions: w.writes };
}

/* The ACS-35 change for one connection, as a site makes it in the
 * Manager: the connection's payload format becomes `JSON (Batched)`
 * (in its ConnectionConfiguration, and in its Edge Agent config entry
 * and every device there, because the agent copies the connection's
 * format over its devices' anyway), and the image pin is removed from
 * its Edge Agent's Deployment, in one go. */
export async function batch (rig: Rig, opts: { connection: string, dry: boolean },
    client?: any)
{
    const fplus = client ?? await service_client();
    const cdb = fplus.ConfigDB;
    const w = new Writer(opts.dry);
    const FORMAT = "JSON (Batched)";

    const c = rig.connections.find(c => c.id == opts.connection);
    if (!c) throw new Error(`No connection ${opts.connection} in the rig`);
    const cuuid = conn_uuid(rig, c), nuuid = node_uuid(rig, c.node);

    const cconf = await cdb.get_config(App.ConnectionConfiguration, cuuid);
    if (!cconf) throw new Error(`${c.name} is not loaded`);
    await w.do(`set ${c.name}'s payload format to ${FORMAT} in its connection config`, () =>
        cdb.put_config(App.ConnectionConfiguration, cuuid,
            { ...cconf, source: { ...cconf.source, payloadFormat: FORMAT } }));

    const agent = await cdb.get_config(App.EdgeAgentConfig, nuuid);
    const entry = agent?.deviceConnections?.find((e: any) => e.uuid == cuuid);
    if (!entry) throw new Error(`${c.node}'s Edge Agent config has no entry for ${c.name}`);
    entry.payloadFormat = FORMAT;
    for (const d of entry.devices ?? []) d.payloadFormat = FORMAT;
    await w.do(`set ${c.name} and its ${entry.devices?.length ?? 0} devices to ${FORMAT} in ${c.node}'s Edge Agent config`,
        () => cdb.put_config(App.EdgeAgentConfig, nuuid, agent));

    const dep = await cdb.get_config(App.EdgeAgentDeployment, nuuid);
    if (dep?.values?.image) {
        const { image, ...values } = dep.values;
        await w.do(`remove the image pin ${JSON.stringify(image)} from ${c.node}'s deployment`, () =>
            cdb.put_config(App.EdgeAgentDeployment, nuuid, { ...dep, values }));
    }
    else
        console.log("%s's deployment has no image pin", c.node);

    console.log("\n%d writes %s", w.writes,
        opts.dry ? "would be made (dry run: rerun with --yes)" : "made");
    return { writes: w.writes };
}
