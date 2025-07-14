import fs from 'fs/promises';
import { isFileExist, normalizePath } from './utils.js';

class StateManager {
    constructor(opts) {
        if (!opts?.env?.STATE_FILE) {
            throw new Error('STATE MANAGER: stateFile path is required');
        }

        this.stateFile = normalizePath(opts.env.STATE_FILE);
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
            let parsed;

            try {
                parsed = JSON.parse(data);
                if (!Array.isArray(parsed)) throw new Error('State file must be an array');
            } catch (jsonErr) {
                console.warn(`STATE MANAGER: Invalid JSON in ${this.stateFile}: ${jsonErr.message}`);
                process.exit(1);
            }

            try {
                const entries = parsed.map(entry => {
                    if (!entry.path) throw new Error('Missing "path" in state entry');
                    return [entry.path, {
                        isUploaded: !!entry.isUploaded,
                        uuid: entry.uuid || null,
                        isClassMember: !!entry.isClassMember,
                        hasSummary: !!entry.hasSummary
                    }];
                });

                this.seenFiles = new Map(entries);
            } catch (err) {
                console.error(`STATE MANAGER: Corrupt state file: ${err.message}`);
                process.exit(1);
            }

            console.log(`STATE MANAGER: Loaded ${this.seenFiles.size} seen files`);
        } catch (err) {
            console.warn(`STATE MANAGER: Failed to load seen files: ${err.message}`);
            process.exit(1);
        }

        return this.seenFiles;
    }

    async addSeenFile(filePath) {
        if (this.seenFiles.has(filePath)) {
            console.warn(`STATE MANAGER: Skipping already seen file: ${filePath}`);
            return;
        }

        this.seenFiles.set(filePath, { isUploaded: false, uuid: null, isClassMember: false, hasSummary: false });
        await this.saveSeenFiles();
    }

    hasSeenFile(filePath) {
        try {
            return this.seenFiles.has(filePath);
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
                isClassMember: !!meta.isClassMember,
                hasSummary: !!meta.hasSummary,
            }));

            await fs.writeFile(this.tempStateFile, JSON.stringify(data, null, 2), 'utf-8');
            await fs.rename(this.tempStateFile, this.stateFile);
        } catch (err) {
            console.warn(`STATE MANAGER: Failed to save seen files: ${err.message}`);
        }
    }

    async updateSeenFiles(filePath, next) {
        try {
            const state = this.getFileState(filePath);

            if (state) {
                next(state);
                await this.saveSeenFiles();
            } else {
                console.warn(`STATE MANAGER: Tried to update isUploaded for unknown file ${filePath}`);
            }
        } catch (err) {
            console.warn(`STATE MANAGER: updateAsUploaded failed: ${err.message}`);
        }
    }

    async updateAsUploaded(filePath) {
        await this.updateSeenFiles(filePath, s => s.isUploaded = true);
    }

    async updateWithUuid(filePath, fileUuid) {
        if (!fileUuid) {
            console.warn(`STATE MANAGER: UUID is invalid for file ${filePath}`);
            return;
        }

        await this.updateSeenFiles(filePath, s => s.uuid = fileUuid);
    }

    async updateAsClassMember(filePath) {
        await this.updateSeenFiles(filePath, s => s.isClassMember = true);
    }

    async updateHasSummary(filePath) {
        await this.updateSeenFiles(filePath, s => s.hasSummary = true);
    }

    getFileState(filePath) {
        try {
            return this.seenFiles.get(filePath);
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
