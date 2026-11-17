/*
 * ACS Edge Agent
 * Split-driver cluster rig: make a rig from connection configs
 * Copyright 2026 University of Sheffield
 *
 *   make-rig <out-dir> <config.json | dir>... [options]
 *
 * Each config is `{agent, sparkplug, connection}`, where `connection`
 * is one `deviceConnections[]` entry of an Edge Agent config with its
 * passwords redacted, or a bare entry. A directory is read for every
 * `*.json` in it, recursively. Writes to <out-dir>:
 *
 *   rig.json       the rig: nodes, connections, mock ports, made-up
 *                  credentials (see rig.ts)
 *   rig.json.gz    the same, small enough for one Kubernetes Secret
 *   mocks.yaml     the namespace, Secret, Deployments and Services
 *                  that run the mocks on a cluster
 *   coverage.md    what the rig covers: protocols, payload formats,
 *                  security modes, path styles and odd cases, per
 *                  connection and in total
 *
 * Options:
 *   --subset <file>      only the configs named in the file, one file
 *                        name (without .json) per line, # comments
 *   --prefix <name>      start of every rig name (default Rig)
 *   --namespace <ns>     namespace for the mocks (default acs-rig)
 *   --image <ref>        mock image (default acs-rig-mocks:dev)
 *   --seed <n>           synthetic data seed (default 1)
 *   --duration <ms>      length of the data loop (default 600000)
 *   --mqtt-interval <ms> MQTT and UDP send interval (default 1000)
 *
 * A rig made from real configs names real things: never write it into
 * the repository.
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";

import { synthesise } from "../fixtures/drivers/synth.js";

import {
    BASE_PORTS, CONTROL_PORT, PROTOCOLS, Protocol, RIG_FORMAT, RIG_VERSION,
    Rig, RigConnection, RigNode, made_up_password, made_up_secret,
    mock_service, sparkplug_safe, write_rig,
} from "./rig.js";

interface Opts {
    subset?:    string,
    prefix:     string,
    namespace:  string,
    image:      string,
    seed:       number,
    duration_ms: number,
    mqtt_interval_ms: number,
}

interface Source {
    file:       string,
    agent:      string,
    sparkplug:  any,
    connection: any,
}

function parse_args (argv: string[]) {
    const pos: string[] = [];
    const opts: Opts = {
        prefix: "Rig", namespace: "acs-rig", image: "acs-rig-mocks:dev",
        seed: 1, duration_ms: 600_000, mqtt_interval_ms: 1000,
    };
    const str: { [k: string]: keyof Opts } = {
        "--subset": "subset", "--prefix": "prefix",
        "--namespace": "namespace", "--image": "image",
    };
    const num: { [k: string]: keyof Opts } = {
        "--seed": "seed", "--duration": "duration_ms",
        "--mqtt-interval": "mqtt_interval_ms",
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a in str) (opts as any)[str[a]] = argv[++i];
        else if (a in num) (opts as any)[num[a]] = Number(argv[++i]);
        else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
        else pos.push(a);
    }
    return { pos, opts };
}

function json_files (p: string): string[] {
    if (!fs.statSync(p).isDirectory()) return [p];
    return fs.readdirSync(p).sort()
        .flatMap(f => json_files(path.join(p, f)))
        .filter(f => f.endsWith(".json"));
}

function load (file: string): Source {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return j.connection
        ? { file, agent: j.agent ?? "", sparkplug: j.sparkplug ?? {}, connection: j.connection }
        : { file, agent: "", sparkplug: {}, connection: j };
}

function read_subset (file: string): Set<string> {
    return new Set(fs.readFileSync(file, "utf8").split("\n")
        .map(l => l.replace(/#.*/, "").trim())
        .filter(l => l)
        .map(l => l.replace(/\.json$/, "")));
}

/* The path part of a base URL, which the agent puts in front of every
 * address. */
function base_path (url: string): string {
    return url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
}

/* Odd things about a connection that the move must survive. These sit
 * beside the fixture generator's own features (path styles, types,
 * security). */
export function odd_cases (conn: any): string[] {
    const out: string[] = [];
    const name = String(conn.name ?? "");
    if (name.includes(".")) out.push("name:dot");
    if (name.includes("_")) out.push("name:underscore");
    if (/\s/.test(name)) out.push("name:space");
    if (/^\d/.test(name)) out.push("name:leading-digit");
    if (/[A-Z]/.test(name)) out.push("name:capitals");
    if (conn.pollInt == undefined) out.push("poll:unset");
    if (conn.payloadFormat == undefined) out.push("format:unset-on-connection");
    const devs = conn.devices ?? [];
    if (devs.length > 1) out.push("devices:several");
    if (devs.some((d: any) => d.payloadFormat != conn.payloadFormat))
        out.push("format:device-differs");
    const addrs = new Map<string, Set<string>>();
    for (const d of devs)
        for (const t of d.tags ?? []) {
            if (t.address == undefined) continue;
            const s = addrs.get(t.address) ?? new Set();
            s.add(d.deviceId);
            addrs.set(t.address, s);
        }
    if ([...addrs.values()].some(s => s.size > 1)) out.push("address:shared-by-devices");
    const metrics = devs.reduce((n: number, d: any) => n + (d.tags?.length ?? 0), 0);
    if (metrics >= 1000) out.push("size:1000+-metrics");
    if (conn.MQTTConnDetails?.protocol == "mqtts" || conn.MQTTConnDetails?.useSSL)
        out.push("mqtt:tls");
    if (/^https:/i.test(conn.RESTConnDetails?.baseURL ?? "")) out.push("rest:https");
    if (conn.RESTConnDetails?.authMethod && conn.RESTConnDetails.authMethod != "None")
        out.push(`rest:auth:${conn.RESTConnDetails.authMethod}`);
    if (conn.OPCUAConnDetails?.useCredentials) out.push("opcua:credentials");
    return out;
}

/* What the rig changes from the source, because a mock can't do it. */
function changes (conn: any): string[] {
    const out: string[] = [];
    if (conn.MQTTConnDetails?.protocol == "mqtts" || conn.MQTTConnDetails?.useSSL)
        out.push("MQTT over TLS becomes plain MQTT: the Edge Agent would not trust a mock's certificate");
    if (/^https:/i.test(conn.RESTConnDetails?.baseURL ?? ""))
        out.push("HTTPS becomes HTTP: the Edge Agent would not trust a mock's certificate");
    return out;
}

/* The features a connection exercises, from a short synthetic fixture
 * and its config. */
function features (src: Source, opts: Opts): { features: string[], findings: number } {
    const interval = Number(src.connection.pollInt) > 0 ? Number(src.connection.pollInt) : 1000;
    try {
        const { fixture } = synthesise(src.connection, {
            agent: src.agent, seed: opts.seed,
            duration_ms: 3 * Math.max(interval, opts.mqtt_interval_ms),
            mqtt_interval_ms: opts.mqtt_interval_ms,
        });
        return {
            features: [...fixture.meta.features, ...odd_cases(src.connection)],
            findings: fixture.meta.findings.length,
        };
    }
    catch (e: any) {
        return { features: [`synth-failed:${e.message}`], findings: 0 };
    }
}

export function make_rig (sources: Source[], opts: Opts): Rig {
    const nodes = new Map<string, RigNode>();
    const node_names = new Set<string>();
    const counters: { [p: string]: number } = {};
    const connections: RigConnection[] = [];

    for (const src of sources) {
        const conn = src.connection;
        const proto = conn.connType as Protocol;
        if (!PROTOCOLS.includes(proto)) {
            console.log("Skipping %s: connection type %s is not mocked", src.file, proto);
            continue;
        }

        /* One rig node per source Edge Agent. The same agent name from
         * two sites gives two nodes. */
        const key = `${path.dirname(src.file)}\0${src.agent}`;
        let node = nodes.get(key);
        if (!node) {
            const base = `${opts.prefix}_${sparkplug_safe(src.agent || "Agent")}`;
            let name = base;
            for (let i = 2; node_names.has(name); i++) name = `${base}_${i}`;
            node_names.add(name);
            node = { name, agent: src.agent, sparkplug: src.sparkplug };
            nodes.set(key, node);
        }

        const n = counters[proto] = (counters[proto] ?? 0) + 1;
        const id = `${proto.toLowerCase().replace(/[^a-z]/g, "")}-${n}`;
        const port = proto == "UDP"
            ? Number(conn.UDPConnDetails?.port ?? 50205)
            : BASE_PORTS[proto] + n - 1;

        const c: RigConnection = {
            id, protocol: proto, node: node.name,
            name: `${opts.prefix}-${conn.name}`,
            source: path.basename(src.file),
            port, changes: changes(conn), connection: conn,
        };
        const op = conn.OPCUAConnDetails, mq = conn.MQTTConnDetails, rs = conn.RESTConnDetails;
        const user =
            proto == "OPC UA" && op?.useCredentials ? (op.username || "rig")
            : proto == "MQTT" && mq?.username ? mq.username
            : proto == "REST" && rs?.authMethod && rs.authMethod != "None" ? (rs.username || "rig")
            : undefined;
        if (user) {
            c.username = user;
            c.password = made_up_password();
            c.secret = made_up_secret();
        }
        if (proto == "REST") c.base_path = base_path(rs?.baseURL ?? "");
        connections.push(c);
    }

    return {
        format: RIG_FORMAT, version: RIG_VERSION,
        prefix: opts.prefix, namespace: opts.namespace,
        seed: opts.seed, duration_ms: opts.duration_ms,
        mqtt_interval_ms: opts.mqtt_interval_ms,
        nodes: [...nodes.values()],
        connections,
    };
}

/* Memory each mock pod asks for. Measured with every connection of the
 * largest site config: OPC UA 380 MiB, MQTT 170 MiB, REST 90 MiB. */
const MOCK_MEMORY: { [p: string]: string } = {
    "OPC UA":   "512Mi",
    "MQTT":     "256Mi",
    "REST":     "128Mi",
};

/* The Kubernetes objects that run the mocks: one Deployment and one
 * Service per protocol, reading the rig from a Secret. UDP has no
 * pod: its sender runs outside the cluster, as a real device does. */
export function manifests (rig: Rig, image: string, gz: Buffer) {
    const ns = rig.namespace;
    const labels = (proto: string) => ({
        "app.kubernetes.io/name":       "acs-rig-mocks",
        "app.kubernetes.io/component":  mock_service(proto as Protocol),
    });
    const items: any[] = [
        { apiVersion: "v1", kind: "Namespace", metadata: { name: ns } },
        {
            apiVersion: "v1", kind: "Secret",
            metadata: { name: "rig", namespace: ns },
            type: "Opaque",
            data: { "rig.json.gz": gz.toString("base64") },
        },
    ];
    for (const proto of PROTOCOLS) {
        if (proto == "UDP") continue;
        const conns = rig.connections.filter(c => c.protocol == proto);
        if (!conns.length) continue;
        const name = mock_service(proto);
        const host = `${name}.${ns}.svc.cluster.local`;
        items.push({
            apiVersion: "apps/v1", kind: "Deployment",
            metadata: { name, namespace: ns, labels: labels(proto) },
            spec: {
                replicas: 1,
                strategy: { type: "Recreate" },
                selector: { matchLabels: labels(proto) },
                template: {
                    metadata: { labels: labels(proto) },
                    spec: {
                        containers: [{
                            name: "mocks", image, imagePullPolicy: "IfNotPresent",
                            args: ["run-mocks", "--rig", "/rig/rig.json.gz",
                                "--protocol", proto, "--advertise", host],
                            ports: [
                                ...conns.map(c => ({ name: c.id, containerPort: c.port })),
                                { name: "control", containerPort: CONTROL_PORT },
                            ],
                            readinessProbe: {
                                httpGet: { path: "/status", port: CONTROL_PORT },
                                periodSeconds: 10,
                            },
                            resources: {
                                requests: { cpu: "20m", memory: MOCK_MEMORY[proto] },
                            },
                            volumeMounts: [{ name: "rig", mountPath: "/rig", readOnly: true }],
                        }],
                        volumes: [{ name: "rig", secret: { secretName: "rig" } }],
                    },
                },
            },
        }, {
            apiVersion: "v1", kind: "Service",
            metadata: { name, namespace: ns, labels: labels(proto) },
            spec: {
                selector: labels(proto),
                ports: [
                    ...conns.map(c => ({ name: c.id, port: c.port, targetPort: c.port })),
                    { name: "control", port: CONTROL_PORT, targetPort: CONTROL_PORT },
                ],
            },
        });
    }
    /* JSON is YAML, and kubectl applies a List. */
    return JSON.stringify({ apiVersion: "v1", kind: "List", items }, null, 1) + "\n";
}

function coverage (rig: Rig, sources: Source[], opts: Opts): string {
    const by_file = new Map(sources.map(s => [path.basename(s.file), s]));
    const total = new Map<string, string[]>();
    const rows: string[] = [];
    for (const c of rig.connections) {
        const src = by_file.get(c.source)!;
        const f = features(src, opts);
        for (const x of f.features) total.set(x, [...total.get(x) ?? [], c.id]);
        const devs = c.connection.devices ?? [];
        const metrics = devs.reduce((n: number, d: any) => n + (d.tags?.length ?? 0), 0);
        rows.push(`| ${c.id} | ${c.node} | ${c.name} | ${devs.length} | ${metrics} | ${f.findings} | ${f.features.join(", ")} | ${c.changes.join("; ")} |`);
    }
    const lines = [
        "# Rig coverage", "",
        `${rig.nodes.length} Edge Agents, ${rig.connections.length} connections: `
            + PROTOCOLS.map(p => `${rig.connections.filter(c => c.protocol == p).length} ${p}`).join(", ")
            + ".", "",
        "Findings are metrics the synthetic data cannot drive (see the driver fixtures README).", "",
        "| Id | Edge Agent | Connection | Devices | Metrics | Findings | Features | Changed for the rig |",
        "|---|---|---|---|---|---|---|---|",
        ...rows, "",
        "## Every feature, and the connections that have it", "",
        "| Feature | Connections |", "|---|---|",
        ...[...total.entries()].sort()
            .map(([k, v]) => `| ${k} | ${v.join(", ")} |`),
        "",
    ];
    return lines.join("\n");
}

function main () {
    const { pos, opts } = parse_args(process.argv.slice(2));
    const [out, ...inputs] = pos;
    if (!out || !inputs.length) {
        console.error("Usage: make-rig <out-dir> <config.json|dir>... [--subset file] "
            + "[--prefix Rig] [--namespace acs-rig] [--image ref] [--seed n] "
            + "[--duration ms] [--mqtt-interval ms]");
        process.exit(2);
    }
    let files = inputs.flatMap(json_files);
    if (opts.subset) {
        const want = read_subset(opts.subset);
        files = files.filter(f => want.has(path.basename(f, ".json")));
        const found = new Set(files.map(f => path.basename(f, ".json")));
        for (const w of want)
            if (!found.has(w)) console.log("Subset names %s, which is not in the inputs", w);
    }
    const sources = files.map(load);
    const rig = make_rig(sources, opts);

    fs.mkdirSync(out, { recursive: true });
    write_rig(path.join(out, "rig.json"), rig);
    const gz = zlib.gzipSync(JSON.stringify(rig));
    fs.writeFileSync(path.join(out, "rig.json.gz"), gz);
    fs.writeFileSync(path.join(out, "mocks.yaml"), manifests(rig, opts.image, gz));
    fs.writeFileSync(path.join(out, "coverage.md"), coverage(rig, sources, opts));

    console.log("%d Edge Agents, %d connections (%s) -> %s",
        rig.nodes.length, rig.connections.length,
        PROTOCOLS.map(p => `${rig.connections.filter(c => c.protocol == p).length} ${p}`).join(", "),
        out);
    console.log("rig.json.gz is %d kB", Math.round(gz.length / 1024));
    for (const c of rig.connections)
        for (const ch of c.changes) console.log("  %s %s: %s", c.id, c.name, ch);
}

if (process.argv[1]?.match(/make-rig\.[jt]s$/))
    main();
