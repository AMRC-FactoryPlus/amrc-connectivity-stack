import chokidar from 'chokidar'
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import {EVENTS} from './file-events.js';
import path from 'path';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const STATE_FILE = path.resolve('./handledFiles.json');
const MAX_RETRIES = 3;

export class FolderWatcher extends EventEmitter{
    constructor(folderPath){
        super();
        this.folderPath = folderPath;
        this.handledFiles = new Set();
        this.retryCounts = new Map();
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
        if(await this.isFileExist(STATE_FILE)){
            try{
                const data = await fs.readFile(STATE_FILE, 'utf-8');
                const files = JSON.parse(data);
                files.forEach(file => this.handledFiles.add(file));
                console.log(`WATCHER: Loaded ${files.length} seen files`);
            }catch(err){
                console.warn(`WATCHER: Failed to load seen files: ${err.message}`);
            }
        }
    }

    async saveSeenFiles(){
        try{
            await fs.writeFile(STATE_FILE, JSON.stringify([...this.handledFiles]), 'utf-8');
        }catch(err){
            console.warn(`Watcher: Failed to save seen files: ${err.message}`);
        }
    }


    async run(){
        await this.loadSeenFiles();

        const watcher = chokidar.watch(this.folderPath, {
            persistent: true,
            ignoreInitial: false,
            awaitWriteFinish: false
        });

        watcher.on('add', async (filePath) => {
            if(this.handledFiles.has(filePath)){
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

            this.handledFiles.add(filePath);
            await this.saveSeenFiles();

            this.emit(EVENTS.NEW_FILE, filePath);


        }catch(err){
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