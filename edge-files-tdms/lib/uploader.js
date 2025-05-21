import { EventEmitter } from 'events';
import fsSync from 'fs';
import path from 'path';
import { EVENTS } from './tdms-file-events.js';
import { Class } from './constants.js';
import { isFileExist } from './utils.js';

class Uploader extends EventEmitter {
    constructor(opts) {
        super();
        this.eventManager = opts.eventManager;
        this.stateManager = opts.stateManager;
        this.fplus = opts.fplus;
        this.configDb = this.fplus.ConfigDB;
        this.username = opts.username;
        this.password = opts.password;
        this.filesServiceUrl = opts.filesServiceUrl;

        this.onNewFileHandler = this.onNewFileHandler.bind(this);
        this.onFileErrorHandler = this.onFileErrorHandler.bind(this);
    }

    async run() {
        console.log('UPLOADER: listening for new files...');
        this.bindToEvents();
    }

    bindToEvents() {
        this.eventManager.on(EVENTS.NEW_FILE, this.onNewFileHandler);
        this.eventManager.on(EVENTS.NEW_FILE_ERROR, this.onFileErrorHandler);
    }

    async onNewFileHandler(filePath) {
        console.log(`UPLOADER: On New File ${filePath}`);
        try {
            if (!(await isFileExist(filePath))) {
                console.error(`UPLOADER: Filepath ${filePath} does not exist.`);
                return;
            }

            const fileState = this.stateManager.getFileState(filePath);
            let fileUuid = fileState?.uuid;

            if(!fileUuid){
                fileUuid = await this.configDb.create_object(Class.File);
                this.eventManager.emit(EVENTS.FILE_UUID_CREATED, filePath, fileUuid);
                console.log(`UPLOADER: Created file object in ConfigDB with UUID ${fileUuid}`);
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
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log(`UPLOADER: Successfully uploaded ${filePath}`, data);

            this.eventManager.emit(EVENTS.UPLOAD_SUCCESS, filePath, fileUuid);
        } catch (err) {
            console.error(`UPLOADER: Error uploading ${filePath}`, err);
            this.eventManager.emit(EVENTS.UPLOAD_FAILED, filePath, err);
        }
    }

    onFileErrorHandler(filePath, err) {
        console.error(`UPLOADER: File error from watcher on ${filePath}`, err);
    }
}

export default Uploader;
