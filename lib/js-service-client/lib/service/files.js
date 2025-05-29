import {ServiceInterface} from "./service-interface.js";
import {App, Class, Service} from "../uuids.js";
import fs from 'fs';
import * as path from "node:path";
import stream from "node:stream";

/** Interface to the File service. */
export class Files extends ServiceInterface {
    constructor(fplus) {
        super(fplus);
        this.service = Service.Files;
        this.file_types = new Map([
            ["pdf",  Class.PDF],
            ["txt",  Class.TXT],
            ["tdms", Class.TDMS],
            ["csv",  Class.CSV],
        ])
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
        return await this.fplus.fetch(opts);
    }

    /**
     * Admin endpoint to list all file uuid's stored in the file service.
     * @returns UUID's of all files stored in acs-files.
     */
    async list_files() {
        const res = await this.fetch('v1/file');
        const st = res.status;
        if (st == 404){
            return;
        }
        if (st != 200){
            this.throw("Can't list files", st);
        }
        return await res.json();
    }

    /**
     * Downloads a file linked to the passed UUID and writes it to disk.
     * @param uuid UUID of the file to download.
     * @param output_path Output location of the file.
     */
    async get_file(uuid, output_path){
        const isNode = typeof window === 'undefined' && typeof process !== 'undefined';
        if(!isNode){
            this.throw("Method not supported in browser");
        }

        const metaData = await this.fplus.ConfigDB.get_config(App.filesConfig, uuid);
        const fileName = metaData.original_file_name || uuid;
        const res = await this.fetch({
            url: `v1/file/${uuid}`,
            method: 'GET',
            accept: 'application/octet-stream',
        });
        const st = res.status;
        if (st == 404){
            return;
        }
        if (st != 200){
            this.throw(`Error finding file: ${uuid}`, st);
        }
        const outputPath = path.resolve(output_path, fileName);
        console.log(outputPath);
        const fileStream = await fs.createWriteStream(outputPath, {flush: true});
        await stream.promises.pipeline(res.body, fileStream);
    }

    /**
     * Uploads a file to the file service using the passed file object uuid.
     * @param uuid The UUID of the file object.
     * @param filePath Path of the file to upload.
     */
    async upload_file_with_object_uuid(uuid, filePath){
        const isNode = typeof window === 'undefined' && typeof process !== 'undefined';
        if(!isNode){
            this.throw("Method not supported in browser");
        }

        const fileName = path.basename(filePath);
        const fileStream = fs.createReadStream(filePath);
        fileStream.on('error', (err) => this.throw(err.message));
        const res = await this.fetch({
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
        const st = res.status;
        if(st == 201) return;
        this.throw(`Error uploading file: ${uuid}`);
    }

    /**
     *
     * @param file
     * @param uuid
     * @returns {Promise<void>}
     */
    async upload_file_with_object_uuid_browser(file, uuid){
        const isNode = typeof window === 'undefined' && typeof process !== 'undefined';
        if(isNode){
            this.throw("Method not supported in node");
        }

        const res = await this.fetch({
            url: `v1/file/${uuid}`,
            method: 'PUT',
            body: file,
            headers: {
                'Content-Type': 'application/octet-stream',
                'original-filename': file.name
            },
            content_type: "application/octet-stream",
            accept: "application/octet-stream",
        });
        const st = res.status;
        if(st == 201) return;
        this.throw(`Error uploading file: ${uuid}`);
    }

    /**
     *
     * @param file
     * @returns {Promise<void>}
     */
    async upload_file_browser(file){
        const isNode = typeof window === 'undefined' && typeof process !== 'undefined';
        if(isNode){
            this.throw("Method not supported in node");
        }

        const uuid = await this.fplus.ConfigDB.create_object(Class.File);
        if(!uuid){
            this.throw(`Error creating file object`);
        }
        await this.upload_file_with_object_uuid_browser(file, uuid);
        const fileName = file.name;
        const extension = fileName.split(".")[1];
        const fileTypeClass = this.file_types.get(extension.toLowerCase());
        if(!fileTypeClass)return;
        await this.fplus.ConfigDB.class_add_member(fileTypeClass, uuid);
    }

    /**
     * Creates a file object, uploads the file to the file service and links the file to a file
     * type if supported.
     * @param filePath Path of the file to upload.
     */
    async upload_file(filePath){
        const isNode = typeof window === 'undefined' && typeof process !== 'undefined';
        if(!isNode){
            this.throw("Method not supported in browser");
        }
        const uuid = await this.fplus.ConfigDB.create_object(Class.File);
        if(!uuid){
            this.throw(`Error creating file object`);
        }
        await this.upload_file_uuid(uuid, filePath);
        const fileName = path.basename(filePath);
        const extension = fileName.split(".")[1];
        const fileTypeClass = this.file_types.get(extension.toLowerCase());
        if(!fileTypeClass)return;
        await this.fplus.ConfigDB.class_add_member(fileTypeClass, uuid);
    }
}