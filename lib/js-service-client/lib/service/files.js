import {ServiceInterface} from "./service-interface.js";
import {Class, Service} from "../uuids.js";

/** Interface to the File service. */
export class Files extends ServiceInterface {
    constructor(fplus) {
        super(fplus);
        this.service = Service.Files;
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
     * Downloads a file linked to the passed UUID and writes it to disk.
     * @platform Node.js only - Not supported in browsers
     * @param uuid UUID of the file to download.
     * @param outputPath Output location of the file including the file name.
     */
    async save_file(uuid, outputPath){
        if(this.fplus.opts.browser){
            this.throw("Method not supported in browser");
        }
        // Dynamically import the node libs if running in node.
        const [fs,stream] = await Promise.all([
            import('fs'),
            import('node:stream')
        ]);
        const fileStream = await fs.createWriteStream(outputPath, {flush: true});
        await stream.promises.pipeline(await this.get_file_stream(uuid), fileStream);
    }

    /**
     * Returns a web stream of the downloaded file.
     * @param uuid unique id of the file
     */
    async get_file_stream(uuid){
        const [st, body] = await this.fetch({
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
        return body;
    }

    /**
     * Uploads a file to the file service using the passed file object uuid.
     * @param uuid The UUID of the file object.
     * @param file Path of the file to upload.
     */
    async upload_file_with_uuid(uuid, file){
        let fileBody;
        let fileName;
        if(file instanceof File) {
            fileBody = file;
            fileName = file.name;
        }else{
            const [fs, path] = await Promise.all([
                import('fs'),
                import('node:path'),
            ])
            fileName = path.basename(file);
            fileBody = fs.createReadStream(file);
        }
        const [st, json] = await this.fetch({
            url: `v1/file/${uuid}`,
            method: 'PUT',
            body: fileBody,
            headers: {
                'Content-Type': 'application/octet-stream',
                'original-filename': fileName
            },
            content_type: "raw",
            accept: "application/octet-stream",
        });
        if(st == 201) {
            return json.uuid
        }
        this.throw(`Error uploading file: ${uuid}`, st);
    }

    /**
     * Creates a file object, uploads the file to the file service and configures the file type.
     * @param file File to upload.
     * @param typeUUID Unique id of the file type.
     */
    async upload_file(typeUUID, file){
        const uuid = await this.fplus.ConfigDB.create_object(Class.File);
        if(!uuid){
            this.throw(`Error creating file object`);
        }
        await this.upload_file_with_uuid(uuid, file);
        await this.fplus.ConfigDB.class_add_member(typeUUID, uuid);
        return uuid;
    }
}