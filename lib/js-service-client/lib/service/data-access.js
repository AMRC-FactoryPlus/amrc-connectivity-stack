/*
 * Factory+ NodeJS Utilities
 * Data Access service interface.
 */

import { Service } from "../uuids.js";
import { ServiceInterface } from "./service-interface.js";

let nodeDepsPromise;

async function loadNodeDeps() {
    if (!nodeDepsPromise) {
        nodeDepsPromise = (async () => {
            const fs = await import("node:fs");
            const path = await import("node:path");
            const { pipeline } = await import("node:stream/promises");
            const { Readable } = await import("node:stream");

            return {
                fs: fs.default,
                path: path.default,
                pipeline,
                Readable
            };
        })();
    }

    return nodeDepsPromise;
}


/* Read the reason from an error response body. The service sends JSON
 * `{ error }` for a rejected filter and plain text for other errors. */
async function error_reason(stream, headers) {
    let text = "";
    try {
        if (stream == null) return "request rejected";
        if (typeof stream.getReader === "function") {
            text = await new Response(stream).text();
        }
        else {
            for await (const chunk of stream) text += chunk;
        }
    }
    catch (e) {
        return "request rejected";
    }

    const ct = headers?.get?.("Content-Type") ?? "";
    if (ct.startsWith("application/json")) {
        try {
            const json = JSON.parse(text);
            if (typeof json?.error === "string") return json.error;
        }
        catch (e) { /* fall through to the raw text */ }
    }

    return text.trim().slice(0, 500) || "request rejected";
}


/* Reads a response body to a string. The body is a web stream in the
 * browser and may be a Node stream under Node. */
async function body_text(body) {
    if (!body) return "";
    if (typeof body.getReader == "function")
        return await new Response(body).text();

    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of body)
        text += typeof chunk == "string"
            ? chunk
            : decoder.decode(chunk, { stream: true });
    return text + decoder.decode();
}

/** 
 * Interface to the Data Access service
 */

export class DataAccess extends ServiceInterface{
    constructor(fplus){
        super(fplus);
        this.service = Service.DataAccess;
        this.log = fplus.debug.bound("data-access");
    }

    async delete_dataset(uuid){
        const [st, json] = await this.fetch(`v1/delete/${uuid}`);
        if(st == 404) return "";
        if(st != 200)
            this.throw (`Can't delete dataset ${uuid}`, st, json);
        
        return json;
    }

    /** 
     * Returns list of dataset uuids with READ_DATASET permission. 
     */
    async get_metadata_list(){
        const [st, json] = await this.fetch('v1/metadata');
        if(st == 404) return [];
        if(st == 403)
            this.throw(`Unauthorised get dataset uuids`, st);
        if(st != 200)
            this.throw(`Can't get dataset uuids`, st);
        return json;
    }


    /**
     * Returns json object with dataset metadata
     */
    async get_single_metadata(uuid){
        const [st, json] = await this.fetch(`v1/metadata/${uuid}`);
        if(st == 404) return {};
        if(st == 403)
            this.throw(`Unauthorised to access dataset ${uuid}`, st);
        if(st != 200)
            this.throw(`Can't get metadata for dataset ${uuid}`, st);
        return json;
    }
    
    /**
     * Downloads a dataset as CSV into `output_dir`.
     *
     * `filter` is optional. Pass `{ metrics: [...] }` to export only
     * those metrics: a selector containing `/` is a full metric path
     * (`Folder/Name`), a selector without `/` matches that metric name
     * at any path. A plain string is still accepted as the deprecated
     * exact Influx `measurement` filter.
     *
     * Returns the path of the written file, or undefined on 404.
     */
    async download_data(uuid, filter=undefined, output_dir = ".") {
        if(this.fplus.opts.browser){
            this.throw(`Method not supported in browser.`);
        }
        // Dynamically import the node libs if running in node
        const { fs, path, pipeline, Readable } = await loadNodeDeps();

        const body = {};

        if (typeof filter === "string") {
            body.measurement = filter;
        }
        else if (filter != null) {
            if (filter.metrics !== undefined)
                body.metrics = filter.metrics;
            if (filter.measurement !== undefined)
                body.measurement = filter.measurement;
        }

        const [st, stream, _, headers] = await this.fetch({
            url: `v1/data/${uuid}`,
            method: "POST",
            accept: "text/csv",
            response_type: "stream",
            body
        });

        if (st === 404) return;

        if (st === 422) {
            const reason = await error_reason(stream, headers);
            this.throw(
                `Can't download dataset ${uuid}: ${reason}`,
                st
            );
        }

        if (st === 403) {
            this.throw(
                `Unauthorised to access dataset ${uuid}`,
                st
            );
        }

        if (st !== 200) {
            this.throw(
                `Can't download data for dataset ${uuid}`,
                st
            );
        }

        const disposition =
            headers.get("Content-Disposition") ?? "";

        const filename =
            /filename\*?=(?:UTF-8'')?("?)([^";]+)\1/i.exec(disposition)?.[2]
            ?? `${uuid}.csv`;

        const safeFilename = filename.replace(/[\/\\]/g, "_");

        fs.mkdirSync(output_dir, { recursive: true });

        const filepath = path.join(output_dir, safeFilename);

        const nodeStream =
            stream instanceof Readable
                ? stream
                : Readable.fromWeb(stream);

        nodeStream.on("error", err => {
            this.throw(`Download stream error: ${err.message}`);
        });

        await pipeline(
            nodeStream,
            fs.createWriteStream(filepath)
        );

        return filepath;
    }

    
    /**
     * Fetches bucketed data counts, metric means and last-data times
     * for a set of devices or one dataset (POST v1/series).
     * @param body The request: {devices | dataset, from, to, every?,
     *   points?, count?, mean?, last?}.
     * @returns The parsed JSON response.
     * Throws a ServiceError carrying the server's error text on any
     * status other than 200.
     */
    async series(body){
        const [st, stream] = await this.fetch({
            url: 'v1/series',
            method: 'POST',
            response_type: 'stream',
            body,
        });

        const text = await body_text(stream);

        if(st != 200)
            this.throw(`Series request failed: ${text || st}`, st, text);

        return JSON.parse(text);
    }

    async get_structure_list(){
        const [st, json] = await this.fetch('v1/structure');
        if(st == 404) return [];
        if(st == 403)
            this.throw(`Unauthorised to get dataset uuids`, st);
        if(st != 200)
            this.throw(`Can't get dataset uuids`, st);
        return json;
    }

    /**
     * Returns list of valid dataset uuids the client has INCLUDE_IN_UNION
     * permission on, i.e. datasets which may be embedded as a Union component.
     */
    async get_union_sources(){
        const [st, json] = await this.fetch('v1/union-sources');
        if(st == 404) return [];
        if(st == 403)
            this.throw(`Unauthorised to get union source uuids`, st);
        if(st != 200)
            this.throw(`Can't get union source uuids`, st);
        return json;
    }

    /**
     * Returns list of valid dataset uuids the client has USE_FOR_SESSION
     * permission on, i.e. datasets which may be used as a Session source.
     */
    async get_session_sources(){
        const [st, json] = await this.fetch('v1/session-sources');
        if(st == 404) return [];
        if(st == 403)
            this.throw(`Unauthorised to get session source uuids`, st);
        if(st != 200)
            this.throw(`Can't get session source uuids`, st);
        return json;
    }

    /**
     * 
     * @param {*} structure is one of the Dataset Definition app uuids src, session or union.   
     * @param {*} config is the config entry content of dataset
     */
    async create_dataset(structure, config){
        const [st, json] = await this.fetch({
            url:'v1/structure',
            method: 'POST',
            body: {
                structure,
                config
            }
        });

        if(st == 404) return "";
        if(st == 403)
            this.throw(`Unauthorised to create a dataset`, st);
        if(st != 200)
            this.throw(`Can't create a dataset`, st);
        return json;
    }



    /**
     * Returns dataset definition (content of the config entry)
     */

    async get_single_structure(uuid){
        const [st, json] = await this.fetch(`v1/structure/${uuid}`);
        if(st == 404) return {};
        if(st == 403)
            this.throw(`Unauthorised to access dataset ${uuid}`, st);
        if(st != 200)
            this.throw(`Can't get dataset definition ${uuid}`, st);
        return json;
    }


    async update_dataset(uuid, structure, config){
        const [st, json] = await this.fetch({
            url: `v1/structure/${uuid}`,
            method: 'PUT',
            body: {
                structure,
                config
            }
        });

        /* A 404 means nothing was saved, so it must not look like success. */
        if(st == 404)
            this.throw(`Dataset ${uuid} not found`, st);
        if(st == 403)
            this.throw(`Unauthorised to update dataset ${uuid}`, st);
        if(st != 200)
            this.throw(`Can't update dataset definition ${uuid}`, st);
        return json;
    }
}