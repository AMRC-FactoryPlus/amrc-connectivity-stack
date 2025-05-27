import fs from 'fs/promises';
import { isFileExist, normalizePath } from './utils.js';
import path from 'path';

class StateManager {
    constructor(opts) {
        if (!opts?.stateFile) {
            throw new Error('STATE MANAGER: stateFile path is required');
        }

        this.stateFile = path.resolve(opts.stateFile);
        this.seenFiles = new Map();
    }


    async run() {
        await this.loadSeenFiles();
    }

    async loadSeenFiles() {
        if (!(await isFileExist(this.stateFile))) {
            return this.seenFiles;
        }

        try {
            const data = await fs.readFile(this.stateFile, 'utf-8');
            let files;

            try {
                files = JSON.parse(data);
                if (!Array.isArray(files)) throw new Error('State file does not contain an array');
            } catch (jsonErr) {
                console.warn(`STATE MANAGER: Invalid JSON in ${this.stateFile}: ${jsonErr.message}`);
                return this.seenFiles;
            }

            for (const file of files) {
                try {
                    const normPath = normalizePath(file.path);
                    this.seenFiles.set(normPath, {
                        isUploaded: !!file.isUploaded,
                        uuid: file.uuid || null
                    });
                } catch (e) {
                    console.warn(`STATE MANAGER: Skipped corrupt file entry: ${e.message}`);
                }
            }

            console.log(`STATE MANAGER: Loaded ${this.seenFiles.size} seen files`);
        } catch (err) {
            console.warn(`STATE MANAGER: Failed to load seen files: ${err.message}`);
        }

        return this.seenFiles;
    }

    async addSeenFile(filePath) {
        try {
            const normPath = normalizePath(filePath);

            if (this.seenFiles.has(normPath)) {
                console.warn(`STATE MANAGER: Skipping already seen file: ${normPath}`);
                return;
            }

            this.seenFiles.set(normPath, { isUploaded: false });
            await this.saveSeenFiles();
        } catch (err) {
            console.error(`STATE MANAGER: Failed to add new file ${filePath}: ${err.message}`);
        }
    }

    hasSeenFile(filePath) {
        try {
            const normPath = normalizePath(filePath);
            return this.seenFiles.has(normPath);
        } catch {
            return false;
        }
    }

    async saveSeenFiles() {
        try {
            const data = [...this.seenFiles.entries()].map(([filePath, meta]) => ({
                path: filePath,
                isUploaded: !!meta.isUploaded,
                uuid: meta.uuid || null,
            }));

            await fs.writeFile(this.stateFile, JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) {
            console.warn(`STATE MANAGER: Failed to save seen files: ${err.message}`);
        }
    }

    async updateAsUploaded(filePath) {
        try {
            const normPath = normalizePath(filePath);
            const state = this.seenFiles.get(normPath);

            if (state) {
                state.isUploaded = true;
                await this.saveSeenFiles();
            } else {
                console.warn(`STATE MANAGER: Tried to update isUploaded for unknown file ${normPath}`);
            }
        } catch (err) {
            console.warn(`STATE MANAGER: updateAsUploaded failed: ${err.message}`);
        }
    }

    async updateWithUuid(filePath, fileUuid) {
        if (!fileUuid) {
            console.warn(`STATE MANAGER: UUID is invalid for file ${filePath}`);
            return;
        }

        try {
            const normPath = normalizePath(filePath);
            const state = this.seenFiles.get(normPath);

            if (state) {
                state.uuid = fileUuid;
                await this.saveSeenFiles();
            } else {
                console.warn(`STATE MANAGER: Tried to update UUID for unknown file ${normPath}`);
            }
        } catch (err) {
            console.warn(`STATE MANAGER: updateWithUuid failed: ${err.message}`);
        }
    }

    getSeenFiles() {
        return this.seenFiles;
    }

    getHandledFilePaths() {
        return [...this.seenFiles.keys()];
    }

    getFileState(filePath) {
        try {
            const normPath = normalizePath(filePath);
            return this.seenFiles.get(normPath);
        } catch {
            return undefined;
        }
    }
}

export default StateManager;
