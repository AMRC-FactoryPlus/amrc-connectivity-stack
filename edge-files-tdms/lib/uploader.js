import fsSync from 'fs';
import path from 'path';
import { EVENTS } from './tdms-file-events.js';
import { Class } from './constants.js';
import { isFileExist } from './utils.js';

class Uploader {
    constructor(opts) {
        this.eventManager = opts.eventManager;
        this.stateManager = opts.stateManager;
        this.fplus = opts.fplus;
        this.configDb = this.fplus.ConfigDB;
        this.username = opts.username;
        this.password = opts.password;
        this.filesServiceUrl = opts.filesServiceUrl;
    }

    async run(){
        this.bindToEvents();
        console.log('UPLOADER: Ready and listening for file events...');
    }

    bindToEvents() {
        this.eventManager.on(EVENTS.FILE_READY, this.handleFileReady.bind(this));
        this.eventManager.on(EVENTS.FILE_READY_FAILED,  this.handleFileReadyError.bind(this));
    }

    async handleFileReady({filePath}) {
        console.log(`UPLOADER: Handling new file: ${filePath}.`);

        try {
            if (!(await isFileExist(filePath))) {
                console.error(`UPLOADER: Filepath ${filePath} does not exist.`);
                return;
            }

            const fileState = this.stateManager.getFileState(filePath);

            if(fileState?.isUploaded){
                console.log(`UPLOADER: Skipping ${filePath}, already uploaded.`);
                this.eventManager.emit(EVENTS.FILE_SKIPPED, {filePath});
                return;
            }

            let fileUuid = fileState?.uuid;

            if(!fileUuid){
                try{
                    fileUuid = await this.configDb.create_object(Class.File);
                    if(fileUuid){
                        this.eventManager.emit(EVENTS.FILE_UUID_CREATED, {filePath, fileUuid});
                        console.log(`UPLOADER: Created file object in ConfigDB with UUID ${fileUuid} for ${filePath}`);
                    }
                }
                catch(configErr){
                    console.error(`UPLOADER: Could not create object in ConfigDB for ${filePath} with error: ${configErr}`);
                    this.eventManager.emit(EVENTS.FILE_UUID_FAILED, {filePath, error: configErr});
                    return;
                }
            }

            const fileName = path.basename(filePath);
            const fileStream = fsSync.createReadStream(filePath);
            const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64');

            const response = await fetch(`${this.filesServiceUrl}/${fileUuid}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'original-filename': fileName,
                    'Content-Type': 'application/octet-stream',
                },
                body: fileStream,
                duplex: 'half'
            });

            if (!response.ok) {
                const errorText = await response.text();

                if (errorText.includes("EEXIST")) {
                    console.warn(`UPLOADER: File already exists on File Service for UUID ${fileUuid}, treating as uploaded.`);
                    this.eventManager.emit(EVENTS.FILE_UPLOADED, { filePath });
                    return;
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log(`UPLOADER: Successfully uploaded ${filePath}`, data);

            this.eventManager.emit(EVENTS.FILE_UPLOADED, {filePath});
        } catch (err) {
            console.error(`UPLOADER: Error uploading ${filePath}`, err);
            this.eventManager.emit(EVENTS.FILE_UPLOAD_FAILED, {filePath, error: err});
        }
    }

    handleFileReadyError({filePath, error}) {
        console.error(`UPLOADER: File error from watcher on ${filePath}`, error);
    }
}

export default Uploader;
