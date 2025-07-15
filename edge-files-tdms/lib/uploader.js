import { waitForFileExist } from './utils.js';
import { Class, File_Type } from './constants.js';

class Uploader {
    constructor(opts) {
        this.eventManager = opts.eventManager;
        this.stateManager = opts.stateManager;
        this.fplus = opts.fplus;
        this.configDb = this.fplus.ConfigDB;
        this.filesClient = this.fplus.Files;
    }

    async run() {
        this.bindToEvents();
        console.log('UPLOADER: Ready and listening for file events...');
    }

    bindToEvents() {
        this.eventManager.on('file:ready', this.handleFileReady.bind(this));
    }

    async createFileUuid(filePath) {
        try {
            const fileUuid = await this.configDb.create_object(Class.File);
            if (fileUuid) {
                this.eventManager.emit('file:uuidCreated', { filePath, fileUuid });
                console.log(`UPLOADER: Created file object in ConfigDB with UUID ${fileUuid} for ${filePath}`);
                return fileUuid;
            }
            return null;
        } catch (configErr) {
            console.error(`UPLOADER: Could not create object in ConfigDB for ${filePath} with error: ${configErr}`);
            this.eventManager.emit('file:uuidFailed', { filePath, error: configErr });
            return null;
        }
    }

    async uploadFileToFS(fileUuid, filePath) {
        try {
            const responseUuid = await this.filesClient.upload_file_with_uuid(fileUuid, filePath);

            console.log(`UPLOADER: Successfully uploaded ${filePath} with uuid ${responseUuid}`);
            this.eventManager.emit('file:uploaded', { filePath });
            return true;

        } catch (fsError) {
            if(fsError.status == 409){
                console.warn(`UPLOADER: File already exists on File Service for UUID ${fileUuid}, updating local state as uploaded.`);
                this.eventManager.emit('file:uploaded', { filePath });
                return true;
            }
            console.error(`UPLOADER: Error uploading ${filePath}`, fsError);
            this.eventManager.emit('file:uploadFailed', { filePath, error: fsError });
            return false;
        }
    }

    async addAsClassMember(fileUuid, filePath) {
        try {
            await this.fplus.ConfigDB.class_add_member(File_Type.TDMS, fileUuid);
            this.eventManager.emit('file:addedAsClassMember', { filePath });
            return true;
        } catch (configErr) {
            console.error(`UPLOADER: Error adding class member for ${filePath}`, configErr);
            this.eventManager.emit('file:addAsClassMemberFailed', { filePath, error: configErr });
            return false;
        }
    }

    async handleFileReady({ filePath }) {
        console.log(`UPLOADER: Handling new file to upload: ${filePath}.`);

        try {
            if (!(await waitForFileExist(filePath))) {
                console.error(`UPLOADER: Filepath ${filePath} does not exist.`);
                this.eventManager.emit('file:readyFailed', { filePath, error: 'File does not exist' });
                return;
            }

            const fileState = await this.stateManager.getFileState(filePath);

            if (fileState?.isUploaded) {
                console.log(`UPLOADER: Skipping ${filePath}, already uploaded.`);
                return;
            }

            let fileUuid = fileState?.uuid;

            if (!fileUuid) {
                fileUuid = await this.createFileUuid(filePath);
                if (!fileUuid) return; // Stop if failed
            }

            if (!fileState?.isClassMember) {
                const added = await this.addAsClassMember(fileUuid, filePath);
                if (!added) return; // Stop if failed
            }

            const uploaded = await this.uploadFileToFS(fileUuid, filePath);
            if (!uploaded) return; // Stop if failed

            console.log(`UPLOADER: Finished processing ${filePath}`);

        } catch (err) {
            console.error(`UPLOADER: Error when handling file: ${err}`);
            this.eventManager.emit('file:readyFailed', { filePath, error: err });
        }
    }
}

export default Uploader;
