import { EVENTS } from './tdms-file-events.js';
import { Class, File_Type } from './constants.js';
import { waitForFileExist } from './utils.js';

class Uploader {
    constructor(opts) {
        this.eventManager = opts.eventManager;
        this.stateManager = opts.stateManager;
        this.fplus = opts.fplus;
        this.configDb = this.fplus.ConfigDB;
        this.filesClient = this.fplus.Files;
        this.username = opts.username;
        this.password = opts.password;
    }

    async run() {
        this.bindToEvents();
        console.log('UPLOADER: Ready and listening for file events...');
    }

    bindToEvents() {
        this.eventManager.on(EVENTS.FILE_READY, this.handleFileReady.bind(this));
        this.eventManager.on(EVENTS.FILE_READY_FAILED, this.handleFileReadyError.bind(this));
    }

    async createFileUuid(filePath) {
        try {
            const fileUuid = await this.configDb.create_object(Class.File);
            if (fileUuid) {
                this.eventManager.emit(EVENTS.FILE_UUID_CREATED, { filePath, fileUuid });
                console.log(`UPLOADER: Created file object in ConfigDB with UUID ${fileUuid} for ${filePath}`);
                return fileUuid;
            }
            return null;
        } catch (configErr) {
            console.error(`UPLOADER: Could not create object in ConfigDB for ${filePath} with error: ${configErr}`);
            this.eventManager.emit(EVENTS.FILE_UUID_FAILED, { filePath, error: configErr });
            return null;
        }
    }

    async uploadFileToFS(fileUuid, filePath) {
        try {
            const responseUuid = await this.filesClient.upload_file_with_uuid(fileUuid, filePath);

            console.log(`UPLOADER: Successfully uploaded ${filePath} with uuid ${responseUuid}`);
            this.eventManager.emit(EVENTS.FILE_UPLOADED, { filePath });
            return true;

        } catch (fsError) {
            if(fsError.status == 409){
                console.warn(`UPLOADER: File already exists on File Service for UUID ${fileUuid}, updating local state as uploaded.`);
                this.eventManager.emit(EVENTS.FILE_UPLOADED, { filePath });
                return true;
            }
            console.error(`UPLOADER: Error uploading ${filePath}`, fsError);
            this.eventManager.emit(EVENTS.FILE_UPLOAD_FAILED, { filePath, error: fsError });
            return false;
        }
    }

    async addAsClassMember(fileUuid, filePath) {
        try {
            await this.fplus.ConfigDB.class_add_member(File_Type.TDMS, fileUuid);
            this.eventManager.emit(EVENTS.FILE_ADDED_AS_CLASS_MEMBER, { filePath });
            return true;
        } catch (configErr) {
            console.error(`UPLOADER: Error adding class member for ${filePath}`, configErr);
            this.eventManager.emit(EVENTS.FILE_ADD_AS_CLASS_MEMBER_FAILED, { filePath, error: configErr });
            return false;
        }
    }

    async handleFileReady({ filePath }) {
        console.log(`UPLOADER: Handling new file: ${filePath}.`);

        try {
            if (!(await waitForFileExist(filePath))) {
                console.error(`UPLOADER: Filepath ${filePath} does not exist.`);
                this.eventManager.emit(EVENTS.FILE_READY_FAILED, { filePath, error: 'File does not exist' });
                return;
            }

            const fileState = await this.stateManager.getFileState(filePath);

            if (fileState?.isUploaded) {
                console.log(`UPLOADER: Skipping ${filePath}, already uploaded.`);
                this.eventManager.emit(EVENTS.FILE_SKIPPED, { filePath });
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
            this.eventManager.emit(EVENTS.FILE_READY_FAILED, { filePath, error: err });
        }
    }

    handleFileReadyError({ filePath, error }) {
        console.error(`UPLOADER: File error from watcher on ${filePath}`, error);
    }
}

export default Uploader;
