import fs from 'fs/promises';
import {isFileExist} from './utils.js';

class StateManager{
    constructor(stateFile){
        this.stateFile = stateFile;
        this.seenFiles = new Map();
    }

    async loadSeenFiles(){
        if(await isFileExist(this.stateFile)){
            try{
                const data = await fs.readFile(this.stateFile, 'utf-8');
                let files;
                try{
                    await JSON.parse(data);
                }catch(jsonErr){
                    console.warn(`STATE MANAGER: Invalid JSON in ${this.stateFile}: ${jsonErr.message}`);
                }

                files.forEach(file => {
                    this.seenFiles.set(file.path, {isUploaded: file.isUploaded});
                });
                console.log(`STATE MANAGER: Loaded ${files.length} seen files`);

                return this.seenFiles;

            }catch(err){
                console.warn(`STATE MANAGER: Failed to load seen files: ${err.message}`);
                return this.seenFiles;
            }
        }
        return this.seenFiles;
    }


    async addSeenFile(filePath){
        if (this.seenFiles.has(filePath)){
            return;
        }
        try{
            this.seenFiles.set(filePath, {isUploaded: false });
            await this.saveSeenFiles();
        }catch(err){
            console.error(`STATE MANAGER: Failed to add new file ${filePath}`);
        }
    }

    hasSeenFile(filePath){
        return this.seenFiles.has(filePath);
    }

    async saveSeenFiles(){
        try{
            const data = [...this.seenFiles.entries()].map(([path, meta]) => ({
                path,
                isUploaded: meta.isUploaded,
                uuid: meta.uuid || null
            }));

            await fs.writeFile(this.stateFile, JSON.stringify(data, null, 2), 'utf-8');
        }catch(err){
            console.warn(`STATE MANAGER: Failed to save seen files: ${err.message}`);
        }
    }

    async updateAsUploaded(filePath){
        if(this.seenFiles.has(filePath)){
            this.seenFiles.get(filePath).isUploaded = true;
            await this.saveSeenFiles();
        }else{
            console.warn(`STATE MANAGER: Tried to update isUploaded for unknown file ${filePath}`);
        }
    }

    async updateWithUuid(filePath, fileUuid){
        if(this.seenFiles.has(filePath)){
            this.seenFiles.get(filePath).uuid = fileUuid;
            await this.saveSeenFiles();
        }else{
            console.warn(`STATE MANAGER: Tried to update UUID for unknown file ${filePath}`);
        }
    }

    getHandledFilePaths(){
        return [...this.seenFiles.keys()];
    }

    getFileState(filePath){
        return this.seenFiles.get(filePath);
    }
}

export default StateManager;