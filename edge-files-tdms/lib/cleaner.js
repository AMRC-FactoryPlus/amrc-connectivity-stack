import fs from 'fs/promises';
import { isFileExist } from './utils.js';

class Cleaner {
    constructor(opts) {
        this.folderToClean = opts.env.TDMS_DIR_TO_WATCH;
        this.eventManager = opts.eventManager;
        this.stateManager = opts.stateManager;
    }

    async run() {
        this.bindToEvents();
        console.log('CLEANER: Ready and listening for file events...');
    }

    bindToEvents() {
        this.eventManager.on('file:delete', this.handleDelete.bind(this));
    }

    isFileFullyProcessed(state) {
        return state.isUploaded && state.uuid && state.isClassMember;
        // todo: && state.hasSummary
    }

    async handleDelete({ filePath }) {
        try {
            if (!(await isFileExist(filePath))) {
                console.log(`CLEANER: filePath ${filePath} does NOT exist.`);
                return;
            }

            const fState = await this.stateManager.getFileState(filePath);

            if (!fState) {
                console.warn(`CLEANER: state for filePath ${filePath} does not exist`);
                return;
            }

            if (this.isFileFullyProcessed(fState)) {
                await fs.unlink(filePath);
                console.log(`CLEANER: Deleted file: ${filePath}`);

                this.stateManager.deleteState(filePath);
                console.log(`CLEANER: Deleted from state ${filePath}`);

            } else {
                console.log(`CLEANER: File not fully processed, skipping delete: ${filePath}`);
            }
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.log(`CLEANER: File already deleted: ${filePath}`);
            } else {
                console.error(`CLEANER: Failed to delete ${filePath}:`, err);
            }
        }
    }
}

export default Cleaner;
