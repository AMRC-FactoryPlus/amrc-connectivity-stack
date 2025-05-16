import fs from "node:fs/promises";
import {App} from "./constants.js";
import path from 'path';
/**
 * Removes temporary files from the kubernetes volume which don't have
 * a file config entry in configDB.
 * @param {Object} opts - Configuration options.
 * @param {string} opts.path - Path to the upload directory.
 * @param {ServiceClient} opts.fplus - The factoryplus service client.
 * @returns {Promise<void>}
 */
export async function clean_up(opts) {
    const uploadPath = opts.path;
    const fplus = opts.fplus;
    const log = fplus.debug.bound("clean_up");
    log("Running cleaning up...");
    let files = [];
    try{
        files = await fs.readdir(uploadPath);
    }
    catch(err){
        if(err.code !== "ENOENT"){
            throw err;
        }
    }
    log("Reading files. Found " + files.length + " files...");
    for (const file of files){
        log("Checking " + file);
        if(!file.match(/^.*\.(temp)$/)){
            continue;
        }
        const tempPath = path.resolve(uploadPath, file);
        const fileUUID = file.split('.')[0];
        log(`Getting config entry for file ${file}.`)
        const config = await fplus.ConfigDB.get_config(App.Config, fileUUID);
        if (config){
            // If we have config, the upload succeeded so rename the temporary file.
            log(`Config found, renaming file ${file}.`)
            const newPath = path.resolve(uploadPath, fileUUID)
            await fs.rename(tempPath, newPath);
        }else{
            // If not config has been found, delete the file.
            log(`No config found, deleting file ${file}.`);
            await fs.unlink(tempPath);
        }
    }
}