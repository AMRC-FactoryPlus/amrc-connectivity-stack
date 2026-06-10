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
     * Download dataset CSV stream
     * Returns a readable stream
     */
    /**
     * Returns a stream of dataset CSV data.
     */
    async download_data(uuid, measurement=undefined, output_dir = ".") {
        if(this.fplus.opts.browser){
            this.throw(`Method not supported in browser.`);
        }
        // Dynamically import the node libs if running in node
        const { fs, path, pipeline, Readable } = await loadNodeDeps();

        const body = {};

        if (measurement !== undefined) {
            body.measurement = measurement;
        }

        const [st, stream, _, headers] = await this.fetch({
            url: `v1/data/${uuid}`,
            method: "POST",
            accept: "application/zip",
            response_type: "stream",
            body
        });

        if (st === 404) return;

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
            ?? `${uuid}.zip`;

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

        if(st == 404) return "";
        if(st == 403)
            this.throw(`Unauthorised to update dataset ${uuid}`, st);
        if(st != 200)
            this.throw(`Can't update dataset definition ${uuid}`, st);
        return json;
    }
}