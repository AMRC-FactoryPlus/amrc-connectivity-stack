import { FolderWatcher } from "../lib/warcher/folder-watcher.js";
import { Uploader } from "../lib/warcher/uploader.js";

const FOLDER_TO_WATCH = '../tests/folder_to_watch'; // move this var somewhere else.

async function main(){
    try{
        const watcher = new FolderWatcher(FOLDER_TO_WATCH);
        const uploader = new Uploader();
        await watcher.run();
        await uploader.run();

        process.send?.('Watcher started successfully.');
    }catch(err){
        console.error('Watcher failed to start: ', err);
        process.exit(1);
    }
}

main();