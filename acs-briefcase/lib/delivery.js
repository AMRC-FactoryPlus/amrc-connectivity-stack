/*
 * ACS Briefcase exporter
 * Deliver briefcases and notices to the sharing platform's ingest container
 * Copyright 2026 University of Sheffield
 */

import fs               from "node:fs";
import fsp              from "node:fs/promises";
import path             from "node:path";
import { pipeline }     from "node:stream/promises";

import yauzl            from "yauzl";

import { sha256_file }  from "./bag.js";
import { defined }      from "./util.js";

/* The version of the notice format. */
const NOTICE_VERSION = 1;

/** The names of a briefcase's blobs in the ingest container. */
export function blob_names (uuid) {
    return {
        zip:        `briefcases/${uuid}.zip`,
        release:    `notices/${uuid}.release.json`,
        withdraw:   `notices/${uuid}.withdraw.json`,
    };
}

/** The notice that tells the platform a briefcase has been released.
 * It carries what the platform cannot learn from the zip itself.
 *
 * @param dataset The dataset's UUID.
 * @param briefcase The briefcase, from the Briefcase release entry.
 * @param source `{ organisation, url }` for the Factory+ instance.
 */
export function release_notice (dataset, briefcase, source) {
    return defined({
        notice:     "release",
        version:    NOTICE_VERSION,
        briefcase:  briefcase.uuid,
        dataset,
        replaces:   briefcase.replaces,
        sha256:     briefcase.sha256,
        size:       briefcase.size,
        built:      briefcase.built,
        exporter:   briefcase.exporter,
        source:     defined(source ?? {}),
    });
}

/** The notice that tells the platform a briefcase has been withdrawn.
 * The reason for the withdrawal stays inside Factory+. */
export function withdraw_notice (dataset, briefcase, source) {
    return {
        notice:     "withdraw",
        version:    NOTICE_VERSION,
        briefcase:  briefcase.uuid,
        dataset,
        withdrawn:  briefcase.withdrawn,
        source:     defined(source ?? {}),
    };
}

/** Read one file from a zip.
 *
 * @param file The zip file.
 * @param wanted A function that picks the entry by its name.
 * @returns The file's content as a Buffer, or null if no entry is
 * picked.
 */
export function read_zip_entry (file, wanted) {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true }, (err, zip) => {
            if (err) return reject(err);
            zip.on("error", reject);
            zip.on("end", () => resolve(null));
            zip.on("entry", entry => {
                if (!wanted(entry.fileName)) return zip.readEntry();
                zip.openReadStream(entry, (err, stream) => {
                    if (err) return reject(err);
                    const chunks = [];
                    stream.on("error", reject);
                    stream.on("data", c => chunks.push(c));
                    stream.on("end", () => {
                        zip.close();
                        resolve(Buffer.concat(chunks));
                    });
                });
            });
            zip.readEntry();
        });
    });
}

/** Open the ingest container.
 *
 * A URL with a query string carries a SAS token and needs nothing
 * else. Otherwise the exporter signs in as a service principal.
 *
 * @param opts.url The container's URL.
 * @param opts.tenant The service principal's tenant ID.
 * @param opts.client The service principal's client ID.
 * @param opts.secret The service principal's client secret.
 * @returns A ContainerClient.
 */
export async function open_container (opts) {
    const { ContainerClient } = await import("@azure/storage-blob");

    if (new URL(opts.url).search)
        return new ContainerClient(opts.url);

    const { tenant, client, secret } = opts;
    if (!tenant || !client || !secret)
        throw new Error("The ingest container needs a SAS token in its URL "
            + "or a service principal");

    /* This is a large library, so load it only when it is used. */
    const { ClientSecretCredential } = await import("@azure/identity");
    return new ContainerClient(opts.url,
        new ClientSecretCredential(tenant, client, secret));
}

export class Delivery {
    /**
     * @param opts.fplus The service client.
     * @param opts.container A ContainerClient for the ingest container.
     * @param opts.work_dir A directory to hold a zip while it is sent.
     * @param opts.source `{ organisation, url }` for the Factory+
     * instance, named in every notice.
     */
    constructor (opts) {
        this.files = opts.fplus.Files;
        this.log = opts.fplus.debug.bound("delivery");
        this.container = opts.container;
        this.work_dir = opts.work_dir;
        this.source = opts.source;
    }

    /* Write a notice. Its name comes from the briefcase's UUID, so
     * sending it again replaces it with the same content. */
    async put_notice (name, notice) {
        const body = JSON.stringify(notice, null, 4) + "\n";
        await this.container.getBlockBlobClient(name)
            .upload(body, Buffer.byteLength(body), {
                blobHTTPHeaders: { blobContentType: "application/json" },
            });
    }

    /* Fetch a briefcase's zip from the Files service, and check it is
     * the zip that was recorded. */
    async fetch_zip (briefcase, file) {
        const body = await this.files.get_file_stream(briefcase.file);
        if (!body)
            throw new Error(`File ${briefcase.file} is not in the Files service`);
        await pipeline(body, fs.createWriteStream(file));

        const { size } = await fsp.stat(file);
        if (size !== briefcase.size)
            throw new Error(`File ${briefcase.file} is ${size} bytes, `
                + `not ${briefcase.size}`);
        const sha256 = await sha256_file(file);
        if (sha256 !== briefcase.sha256)
            throw new Error(`File ${briefcase.file} has checksum ${sha256}, `
                + `not ${briefcase.sha256}`);
    }

    /** The access tier a briefcase was released under, read from the
     * release policy inside its zip. A briefcase built before the tier
     * was recorded has it nowhere else: the dataset's policy may have
     * changed since.
     *
     * @param briefcase The briefcase, from the Briefcase release entry.
     */
    async tier (briefcase) {
        const file = path.join(this.work_dir, `${briefcase.uuid}.tier.zip`);
        try {
            await this.fetch_zip(briefcase, file);
            /* The bag sits under one top-level directory. */
            const json = await read_zip_entry(file,
                name => /^[^/]+\/data\/policy\.json$/.test(name));
            const tier = json && JSON.parse(json).tier;
            if (!tier)
                throw new Error(`Briefcase ${briefcase.uuid} has no tier `
                    + `in its release policy`);
            return tier;
        }
        finally {
            await fsp.rm(file, { force: true });
        }
    }

    /** Deliver a briefcase: its zip, then its release notice. The
     * platform acts on the notice, so the zip must be there first.
     *
     * @param dataset The dataset's UUID.
     * @param briefcase The briefcase, from the Briefcase release entry.
     */
    async release (dataset, briefcase) {
        const names = blob_names(briefcase.uuid);
        const file = path.join(this.work_dir, `${briefcase.uuid}.push.zip`);
        try {
            await this.fetch_zip(briefcase, file);
            this.log("Sending briefcase %s, %d bytes",
                briefcase.uuid, briefcase.size);
            await this.container.getBlockBlobClient(names.zip)
                .uploadFile(file, {
                    blobHTTPHeaders: { blobContentType: "application/zip" },
                });
            await this.put_notice(names.release,
                release_notice(dataset, briefcase, this.source));
        }
        finally {
            await fsp.rm(file, { force: true });
        }
    }

    /** Tell the platform that a briefcase has been withdrawn.
     *
     * @param dataset The dataset's UUID.
     * @param briefcase The briefcase, with its `withdrawn` time.
     */
    async withdraw (dataset, briefcase) {
        const names = blob_names(briefcase.uuid);
        await this.put_notice(names.withdraw,
            withdraw_notice(dataset, briefcase, this.source));
    }
}
