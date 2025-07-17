import express from 'express';
import fs from 'node:fs/promises'
import path from 'path';
import {parseSize} from "./parseSize.js";
import streamSize  from "stream-size";
const getSizeTransform = streamSize.default;
import * as stream from "node:stream";
import { normalizePath, sanityCheckFilename } from '../utils.js';

const MAX_FILE_SIZE = parseSize(process.env.BODY_LIMIT || '15GB');

export class APIv1 {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.auth = this.fplus.Auth;
        this.log = this.fplus.debug.bound("api-v1");
        this.uploadPath = opts.uploadPath;
        this.routes = express.Router();
        this.setup_routes();
        this.eventManager = opts.eventManager;
        this.stateManager = opts.stateManager;
    }

    setup_routes() {
        let api = this.routes;
        api.post('/', this.post_file.bind(this));

        // to be deleted
        api.get('/test', this.get_test.bind(this));
    }

    // to be deleted
    async get_test(req, res){
        return res.status(200).json({ test: 'success_test' });
    }

    async post_file(req, res) {
        try{
            const filename = req.query.filename;

            if(!filename){
                return res.status(400).json({message: 'Filename is required.'});
            }

            if(!sanityCheckFilename(filename)){
                return res.status(400).json({message: 'Invalid filename.'});
            }

            const uploadDir = this.uploadPath;
            const finalPath = normalizePath(path.join(uploadDir, filename));

            // Generating secure random filename
            const tempName = crypto.randomUUID();
            const tempPath = path.join(this.uploadPath, `${tempName}.temp`);

            await fs.mkdir(this.uploadPath, { recursive: true });

            // Check if the temporary file already exists.
            let fileHandle;
            try {
                fileHandle = await fs.open(tempPath, 'wx');
            } catch (error) {
                const statusCode = error.code === 'EEXIST' ? 503 : 500;
                return res.status(statusCode).json({ message: error.message });
            }

            const writeStream = fileHandle.createWriteStream({ flush: true });
            /* Now fileHandle belongs to the WriteStream; we mustn't touch it again */

            const unlock_tempfile = async () => {
                await new Promise(resolve => writeStream.close(resolve));
                await fs.unlink(tempPath);
            };

            // Check if the file already exists.
            const fileExists = await fs.access(finalPath, fs.constants.F_OK)
                .then(() => true, () => false);
            if (fileExists){
                await unlock_tempfile();
                return res.status(409).json({ message: `File with UUID ${file_uuid} already exists.` });
            }

            this.log("Writing to temp file");

            const sizeLimit = getSizeTransform(MAX_FILE_SIZE);

            const [st, err] = await stream.promises.pipeline(req, sizeLimit, writeStream)
                .then(() => [201])
                .catch(e => [/^Stream exceeded maximum size/.test(e.message) ? 413 : 500, e]);

            if (st != 201) {
                this.log("File upload failed: %o", err);
                await unlock_tempfile();
                return res.status(st).json({ message: err.message });
            }

            this.log("Renaming file.");

            // Rename the temporary file now it's written to disk.
            await fs.rename(tempPath, finalPath);

            if (!this.stateManager.hasSeenFile(finalPath)) {
                try{
                    await this.stateManager.addSeenFile(finalPath);

                    this.eventManager.emit('file:ready', { filePath: finalPath });

                    return res.status(201).json({
                        message: 'File uploaded successfully to the driver.',
                        filename: filename,
                    });
                }catch(err){
                    console.error(`Failed to persist state for file ${finalPath}:`, err);
                    return res.status(500).json({error: err.message});
                }
            }
        }
        catch(err){
            return res.status(500).json({error: err.message});
        }
    }
}