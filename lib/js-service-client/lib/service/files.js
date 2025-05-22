import {ServiceInterface} from "./service-interface.js";
import {App, Class, Service} from "../uuids.js";
import fs from 'fs';
import * as path from "node:path";
import stream from "node:stream";

export class Files extends ServiceInterface {
    constructor(fplus) {
        super(fplus);
        this.service = Service.Files;
    }

    async fetch (opts) {
         if (typeof opts == "string")
            opts = { url: opts };
        let body;
        if("body" in opts && opts.content_type === "application/octet-stream") {
            body = opts.body;
        }else if("body" in opts){
            body = JSON.stringify(opts.body);
        }
        const headers = { ...opts.headers };
        headers["Accept"] = opts.accept ?? "application/json";
        if (body){
            headers["Content-Type"] = opts.content_type ?? "application/json";
        }
        opts = {
            ...opts,
            service:    this.service,
            headers,
            body,
        };
        const res = await this.fplus.fetch(opts);

        const contentType = res.headers.get('Content-Type');
        if(contentType.includes("application/json") || !contentType){
            return [res.status, await res.json()];
        }
        else if(contentType.includes("application/octet-stream")){
            return [res.status, undefined, res.body];
        }
    }

    /**
     * Admin endpoint to list all file uuid's stored in the file service.
     * @returns UUID's of all files stored in acs-files.
     */
    async list_files() {
        const [st, json] = await this.fetch('v1/file');
        if (st == 404){
            return;
        }
        if (st != 200){
            this.throw("Can't list files", st);
        }
        return json;
    }

    /**
     * Makes to get request to the file service to download the file.
     * @param uuid UUID of the file to download.
     * @param output_path Output location of the file.
     */
    async get_file(uuid, output_path){
        const metaData = await this.fplus.ConfigDB.get_config(App.filesConfig, uuid);
        const outputFile = path.resolve(output_path, metaData.original_file_name);
        const [st, ,body] = await this.fetch({
            url: `v1/file/${uuid}`,
            method: 'GET',
            accept: 'application/octet-stream',
        });
        if (st == 404){
            return;
        }
        if (st != 200){
            this.throw(`Error finding file: ${uuid}`, st);
        }

        const fileStream = await fs.createWriteStream(outputFile, {flush: true});
        await stream.promises.pipeline(body, fileStream);
        return;
    }

    /**
     * Uploads a file to the file service and creates the metadata entries in ConfigDB.
     * @param uuid The UUID of the file object.
     * @param filePath The path to the file to upload.
     */
    async upload_file(uuid, filePath){
        const fileName = path.basename(filePath);
        const fileStream = fs.createReadStream(filePath);
        fileStream.on('error', (err) => this.throw(err.message));
        const [st] = await this.fetch({
            url: `v1/file/${uuid}`,
            method: 'PUT',
            body: fileStream,
            headers: {
                'Content-Type': 'application/octet-stream',
                'original-filename': fileName
            },
            content_type: "application/octet-stream",
            accept: "application/octet-stream",
        });
        fileStream.close();
        if(st == 201) return;
        this.throw(`Error uploading file: ${uuid}`);
    }
}