/*
 * ACS Briefcase exporter
 * Build the briefcase of one dataset
 * Copyright 2026 University of Sheffield
 */

import crypto           from "node:crypto";
import fsp              from "node:fs/promises";
import path             from "node:path";
import { Readable }     from "node:stream";

import { UUIDs }        from "@amrc-factoryplus/rx-client";

import { write_bag, zip_bag } from "./bag.js";
import { App }          from "./constants.js";
import { build_crate }  from "./crate.js";
import { describe_device } from "./device.js";
import { write_parquet } from "./parquet.js";
import { split_telemetry } from "./telemetry.js";
import { defined }      from "./util.js";

/** Describe a dataset from its Data Access metadata.
 *
 * Only these fields leave Factory+. The metadata apps also hold the
 * names of the people who made and ran the trial, free-text notes and
 * MES identifiers, and none of those are copied.
 */
export function describe_dataset (meta) {
    const md = meta.metadata ?? {};
    const run = md[App.RunMetadata] ?? {};
    return defined({
        name:           meta.name,
        description:    run.description,
        reference:      run.reference,
        from:           meta.from,
        to:             meta.to,
        tags:           md[App.Tags]?.tags,
    });
}

async function write_json (file, value) {
    await fsp.writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

export class Builder {
    constructor (opts) {
        this.da = opts.fplus.DataAccess;
        this.cdb = opts.fplus.ConfigDB;
        this.log = opts.fplus.debug.bound("builder");

        this.work_dir = opts.work_dir;
        this.exporter = opts.exporter;
        this.source = opts.source;
    }

    /* The dataset's telemetry, as a Node stream of Data Access CSV. */
    async telemetry (dataset) {
        const [st, body] = await this.da.fetch({
            url:            `v1/data/${dataset}`,
            method:         "POST",
            accept:         "text/csv",
            response_type:  "stream",
            body:           {},
        });
        if (st != 200)
            throw new Error(`Data Access returned ${st} for the data of ${dataset}`);
        return body instanceof Readable ? body : Readable.fromWeb(body);
    }

    async device (uuid) {
        const [info, general] = await Promise.all([
            this.cdb.get_config(UUIDs.App.DeviceInformation, uuid),
            this.cdb.get_config(UUIDs.App.Info, uuid),
        ]);
        return describe_device({ uuid, name: general?.name, info });
    }

    /** Build a briefcase of a dataset.
     *
     * @param dataset The dataset UUID.
     * @returns `{ dataset, briefcase, version, built, file, size,
     * sha256 }`, where `file` is the zip in the work directory.
     */
    async build (dataset) {
        const meta = await this.da.get_single_metadata(dataset);
        if (!meta?.name)
            throw new Error(`Data Access has no metadata for ${dataset}`);

        const policy = meta.metadata?.[App.ReleasePolicy];
        if (!policy)
            throw new Error(`${dataset} has no release policy`);
        if (!meta.from || !meta.to)
            throw new Error(`${dataset} has no start and end time`);

        /* Nothing records briefcases yet, so every build is a new
         * briefcase at version 1. */
        const briefcase = crypto.randomUUID();
        const version = 1;
        const built = new Date();
        const name = `briefcase-${briefcase}-v${version}`;

        const bag = await fsp.mkdtemp(path.join(this.work_dir, "build-"));
        try {
            const data = path.join(bag, "data");
            const csv_dir = path.join(data, "telemetry", "csv");
            const pq_dir = path.join(data, "telemetry", "parquet");
            const dev_dir = path.join(data, "metadata", "devices");
            for (const dir of [csv_dir, pq_dir, dev_dir])
                await fsp.mkdir(dir, { recursive: true });

            const telemetry = await split_telemetry(
                await this.telemetry(dataset), csv_dir);

            /* The Parquet copy is made from the CSV, so the two can't
             * disagree. */
            for (const [uuid, t] of telemetry) {
                t.parquet = `${uuid}.parquet`;
                await write_parquet(path.join(csv_dir, t.file),
                    path.join(pq_dir, t.parquet));
            }

            const devices = [];
            for (const uuid of telemetry.keys()) {
                const device = await this.device(uuid);
                await write_json(path.join(dev_dir, `${uuid}.json`), device);
                devices.push(device);
            }

            const described = describe_dataset(meta);
            await write_json(path.join(data, "metadata", "dataset.json"), described);
            await write_json(path.join(data, "policy.json"), policy);

            const size = async rel => (await fsp.stat(path.join(data, rel))).size;
            const files = [
                {
                    path:           "metadata/dataset.json",
                    name:           "Dataset description",
                    description:    "The dataset's name, time range, tags and description.",
                    format:         "application/json",
                },
                {
                    path:           "policy.json",
                    name:           "Release policy",
                    description:    "The terms this data is released under.",
                    format:         "application/json",
                },
                ...devices.flatMap(d => {
                    const t = telemetry.get(d.uuid);
                    const label = d.name ?? d.uuid;
                    return [
                        {
                            path:           `telemetry/csv/${t.file}`,
                            name:           `Telemetry from ${label}`,
                            description:    `${t.rows} data points, one per row: `
                                + "timestamp (UTC, to the nanosecond), metric (the full "
                                + "Sparkplug name), type, value and unit.",
                            format:         "text/csv",
                            device:         d.uuid,
                            first:          t.first,
                            last:           t.last,
                        },
                        {
                            path:           `telemetry/parquet/${t.parquet}`,
                            name:           `Telemetry from ${label}, as Parquet`,
                            description:    `The same ${t.rows} data points as the CSV, `
                                + "in the same order. timestamp is UTC, truncated to the "
                                + "microsecond, and timestamp_ns is the exact time in "
                                + "nanoseconds since 1970. Each row sets only the value "
                                + "column its type names: value_double, value_int, "
                                + "value_uint, value_boolean or value_string.",
                            format:         "application/vnd.apache.parquet",
                            device:         d.uuid,
                            first:          t.first,
                            last:           t.last,
                        },
                        {
                            path:           `metadata/devices/${d.uuid}.json`,
                            name:           `Description of ${label}`,
                            description:    "The device's objects and schemas, and "
                                + "the type, unit and documentation of each metric.",
                            format:         "application/json",
                            device:         d.uuid,
                        },
                    ];
                }),
            ];
            for (const f of files)
                f.size = await size(f.path);

            await write_json(path.join(data, "ro-crate-metadata.json"),
                build_crate({
                    briefcase, version, files, policy,
                    built:      built.toISOString(),
                    dataset:    described,
                    devices:    devices.map(d => ({ uuid: d.uuid, name: d.name })),
                    exporter:   this.exporter,
                    source:     this.source,
                }));

            await write_bag(bag, [
                ["Source-Organization",     policy.data_owner.organisation],
                ["Contact-Name",            policy.data_owner.contact.name],
                ["Contact-Email",           policy.data_owner.contact.email],
                ["External-Description",    described.name],
                ["External-Identifier",     `urn:uuid:${briefcase}`],
                ["Bagging-Date",            built.toISOString().slice(0, 10)],
                ["Version",                 version],
            ]);

            const file = path.join(this.work_dir, `${name}.zip`);
            const zip = await zip_bag(bag, name, file, built);
            this.log("Built %s from %s: %d devices, %d bytes",
                name, dataset, devices.length, zip.size);

            return {
                dataset, briefcase, version, file,
                built:  built.toISOString(),
                ...zip,
            };
        }
        finally {
            await fsp.rm(bag, { recursive: true, force: true });
        }
    }
}
