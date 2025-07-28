
class Uploader {
    constructor(opts) {
        this.eventManager = opts.eventManager;
        this.stateManager = opts.stateManager;
        this.fileTypeClass = opts.fileTypeClass;
        this.fileClass = opts.fileClass;
        
        this.fplus = opts.fplus;
        this.configDb = this.fplus.ConfigDB;
        this.filesClient = this.fplus.Files;

        this.queue = [];
        this.isProcessing = false;
    }

    async run() {
        this.bindToEvents();
        console.log('UPLOADER: Ready and listening for file events...');
    }

    bindToEvents() {
        this.eventManager.on('file:ready', this.enqueueFile.bind(this));
    }

    enqueueFile({ filePath }) {
        this.queue.push(filePath);
        this.processQueue();
    }

    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const filePath = this.queue.shift();
            await this.processFile(filePath);
        }

        this.isProcessing = false;
    }

    async processFile(filePath) {
        console.log(`UPLOADER: Handling new file to upload: ${filePath}.`);

        try {
            const fileState = await this.stateManager.getFileState(filePath);

            if (fileState?.isUploaded) {
                console.log(`UPLOADER: Skipping ${filePath}, already uploaded.`);
                return;
            }

            let fileUuid = fileState?.uuid;

            if (!fileUuid) {
                fileUuid = await this.createFileUuid(filePath);
            }

            if (!fileState?.isClassMember) {
                await this.addAsClassMember(fileUuid, filePath);
            }

            await this.uploadFileToFS(fileUuid, filePath);

            console.log(`UPLOADER: Finished processing ${filePath}`);
        } catch (err) {
            console.error(`UPLOADER: Error when handling file: ${err}`);
            this.eventManager.emit('file:uploadFailed', { filePath, error: err });
        }
    }

    async createFileUuid(filePath) {
        try {
            const fileUuid = await this.configDb.create_object(this.fileClass);
            if (!fileUuid) {
                throw new Error(`ConfigDB returned null UUID for file ${filePath}`);
            }

            this.eventManager.emit('file:uuidCreated', { filePath, fileUuid });
            console.log(`UPLOADER: Created file object in ConfigDB with UUID ${fileUuid} for ${filePath}`);
            return fileUuid;
        } catch (err) {
            console.error(`UPLOADER: Could not create object in ConfigDB for ${filePath}:`, err);
            throw err;
        }
    }

    async addAsClassMember(fileUuid, filePath) {
        try {
            // File_Type.TDMS
            await this.fplus.ConfigDB.class_add_member(this.fileTypeClass, fileUuid);
            this.eventManager.emit('file:addedAsClassMember', { filePath });
        } catch (err) {
            console.error(`UPLOADER: Error adding class member for ${filePath}:`, err);
            throw err;
        }
    }

    async uploadFileToFS(fileUuid, filePath) {
        try {
            const responseUuid = await this.filesClient.upload_file_with_uuid(fileUuid, filePath);

            console.log(`UPLOADER: Successfully uploaded ${filePath} with uuid ${responseUuid}`);
            this.eventManager.emit('file:uploaded', { filePath });
        } catch (err) {
            if (err.status === 409) {
                console.warn(`UPLOADER: File already exists on File Service for UUID ${fileUuid}, marking as uploaded.`);
                this.eventManager.emit('file:uploaded', { filePath });
            } else {
                console.error(`UPLOADER: Error uploading ${filePath}:`, err);
                throw err;
            }
        }
    }
}

export default Uploader;
