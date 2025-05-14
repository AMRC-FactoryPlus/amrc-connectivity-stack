import fs from "fs";
import {App} from "./constants.js";
import path from 'path';
/**
 *
 * @param opts
 * @returns {Promise<void>}
 */
export async function clean_up(opts) {
    const uploadPath = opts.path;
    const fplus = opts.fplus;
    const log = fplus.debug.bound("clean_up");
    const exists = await fs.promises.access(uploadPath)
        .then(() => true, () => false);
    if (!exists){
        log("Start path doesn't exist");
        return;
    }
    // search for existing temporary files
    const files = await fs.promises.readdir(uploadPath);
    log("Reading files. Found " + files.length + " files...");
    log(JSON.stringify(files));
    // check for a file configuration entry
    for (const file of files){
        log("Reading " + file);
        const test = file.match(/^.*\.(temp)$/);
        log("Result " + JSON.stringify(test));
        if(!file.match(/^.*\.(temp)$/g)){
            log("No match found for " + file);
            continue;
        }
        const tempPath = path.resolve(uploadPath, file);
        const fileUUID = file.split('.')[0];
        log("file matched regex " + file);
        log("Getting config entry for file.")
        const config = await fplus.ConfigDB.get_config(App.Config, fileUUID);
        // If we have config, the upload succeeded so rename the temporary file.
        if (config){
            log("Config found, renaming file.")
            const newPath = path.resolve(uploadPath, fileUUID)
            await fs.promises.rename(tempPath, newPath);
        }else{
            log("No config found, deleting file.");
            // If not config has been found, delete the file.
            await fs.promises.unlink(tempPath);
        }
    }
}