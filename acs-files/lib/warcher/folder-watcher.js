import chokidar from 'chokidar'
import fs from 'fs/promises';
import { sleep } from '../utils/time_utils.js';
import { EventEmitter } from 'events';

export class FolderWatcher extends EventEmitter{
    constructor(folderPath){
        super();
        this.folderPath = folderPath
    }

    async run(){
        chokidar.watch(this.folderPath).on('addDir', (path) => {
            console.log(`WATCHER: Started to watch ${path}`);
        })
        chokidar.watch(this.folderPath).on('add', (path) =>{
            console.log(`WATCHER: File detected - ${path}`);
            this.waitForCompleteWrite(path)
            .then(() => {
                console.log(`WATCHER: File Ready - ${path}`)
            })
            .catch(err => {
                console.error(`WATCHER: Error watching file ${path}`, err);
            });
        })
    }

    async waitForCompleteWrite(filePath, interval = 200, checks=3){
        let stableCount = 0;
        let lastSize = -1;

        while(stableCount < checks){
            try{
                const {size} = await fs.stat(filePath);
                if(size === lastSize){
                    stableCount++;
                }else{
                    stableCount = 0;
                    lastSize = size;
                }
            }
            catch(err){
                throw err;
            }
            await sleep(interval);
        }
    }
}