import fs from 'fs/promises';

class StateManager{
    constructor(stateFile){
        this.stateFile = stateFile;
        this.seenFiles = new Map();
    }

    async isFileExist(filePath){
        try{
            await fs.access(filePath);
            return true;
        }
        catch{
            return false;
        }
    }

    async loadSeenFiles(){
        if(await this.isFileExist(this.stateFile)){
            try{
                const data = await fs.readFile(this.stateFile, 'utf-8');
                const files = await JSON.parse(data);

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
                isUploaded: meta.isUploaded
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
        }
    }

    getHandledFilePaths(){
        return [...this.seenFiles.keys()];
    }
}

export default StateManager;