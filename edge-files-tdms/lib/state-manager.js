import fs from 'fs/promises';
import path from 'path';
import { isFileExist, normalizePath } from './utils.js';

class StateManager {
    constructor(opts) {
        if (!opts?.stateFile) {
            throw new Error('STATE MANAGER: stateFile path is required');
        }

        this.stateFile = path.resolve(opts.stateFile);
        this.tempStateFile = `${this.stateFile}.tmp`;
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
                        uuid: file.uuid || null,
                        isClassMember: !!file.isClassMember
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

            this.seenFiles.set(normPath, { isUploaded: false, uuid: null, isClassMember: false });
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
                isClassMember: !!meta.isClassMember
            }));

            await fs.writeFile(this.tempStateFile, JSON.stringify(data, null, 2), 'utf-8');
            await fs.rename(this.tempStateFile, this.stateFile);
        } catch (err) {
            console.warn(`STATE MANAGER: Failed to save seen files: ${err.message}`);
        }
    }

    async updateAsUploaded(filePath) {
        try {
            const state = this.getFileState(filePath);

            if (state) {
                state.isUploaded = true;
                await this.saveSeenFiles();
            } else {
                console.warn(`STATE MANAGER: Tried to update isUploaded for unknown file ${filePath}`);
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
            const state = this.getFileState(filePath);

            if (state) {
                state.uuid = fileUuid;
                await this.saveSeenFiles();
            } else {
                console.warn(`STATE MANAGER: Tried to update UUID for unknown file ${filePath}`);
            }
        } catch (err) {
            console.warn(`STATE MANAGER: updateWithUuid failed: ${err.message}`);
        }
    }

    async updateAsClassMember(filePath) {
        try {
            const state = this.getFileState(filePath);
            if (state) {
                state.isClassMember = true;
                await this.saveSeenFiles();
            } else {
                console.warn(`STATE MANAGER: Tried to update isClassMember for unknown file ${filePath}`);
            }
        } catch (err) {
            console.warn(`STATE MANAGER: updateAsClassMember failed: ${err.message}`);
        }
    }

    getFileState(filePath) {
        try {
            const normPath = normalizePath(filePath);
            return this.seenFiles.get(normPath);
        } catch {
            return undefined;
        }
    }

    getSeenFiles() {
        return this.seenFiles;
    }

    getHandledFilePaths() {
        return [...this.seenFiles.keys()];
    }
}

export default StateManager;
