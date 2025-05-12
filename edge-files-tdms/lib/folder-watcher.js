import chokidar from 'chokidar'
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import {EVENTS} from './file-events.js';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_RETRIES = 3;

class FolderWatcher extends EventEmitter{
    constructor(folderPath, stateManager){
        super();
        this.folderPath = folderPath;
        this.stateManager = stateManager;
        this.retryCounts = new Map();
        this.seenFiles = new Set();
    }

    async run(){
        await this.stateManager.loadSeenFiles();
        this.seenFiles = new Set(this.stateManager.getHandledFilePaths());

        const watcher = chokidar.watch(this.folderPath, {
            persistent: true,
            ignoreInitial: false,
            awaitWriteFinish: false
        });

        watcher.on('add', async (filePath) => {
            if(this.seenFiles?.has(filePath)){
                return;
            }
            console.log(`WATCHER: File detected - ${filePath}`);
            this.handleFile(filePath);
        });

        watcher.on('addDir', (dirPath) => {
            console.log(`WATCHER: Now watching directory - ${dirPath}`);
        });
    }

    async handleFile(filePath){
        try{
            await this.isFileReady(filePath);
            console.log(`WATCHER: File ready ${filePath}`);

            if(!this.stateManager.hasSeenFile(filePath)){
                await this.stateManager.addSeenFile(filePath);
                this.emit(EVENTS.NEW_FILE, filePath);
            }
        }
        catch(err){
            console.warn(`WATCHER: File not ready - ${filePath}: ${err.message}`);

            const retries = this.retryCounts.get(filePath) || 0;
            if (retries < MAX_RETRIES){
                this.retryCounts.set(filePath, retries + 1);
                console.log(`WATCHER: Retrying (${retries + 1}/${MAX_RETRIES}) - ${filePath}`);
                setTimeout(() => this.handleFile(filePath), 2000);
            }
            else{
                this.retryCounts.delete(filePath);
                this.emit(EVENTS.FILE_ERROR, {filePath, error: err});
            }
        }
    }

    async isFileReady(filePath, interval = 500, checks = 4){
        let stableCount = 0;
        let lastSize = -1;

        while(stableCount < checks){
            const {size} = await fs.stat(filePath);
            if(size === lastSize){
                stableCount++;
            }else{
                stableCount = 0;
                lastSize = size;
            }
            await sleep(interval);
        }
    }
}

export default FolderWatcher;