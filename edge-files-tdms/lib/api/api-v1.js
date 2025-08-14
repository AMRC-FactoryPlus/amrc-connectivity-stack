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
        let finalPathWritten = false;
        let finalPath;

        try {
            const filename = req.query.filename;

            if (!filename) {
                return res.status(400).json({ message: 'Filename is required.' });
            }

            if (!sanityCheckFilename(filename)) {
                return res.status(400).json({ message: 'Invalid filename.' });
            }

            const uploadDir = this.uploadPath;
            finalPath = normalizePath(path.join(uploadDir, filename));

            const tempName = crypto.randomUUID();
            const tempPath = path.join(uploadDir, `${tempName}.temp`);

            await fs.mkdir(uploadDir, { recursive: true });

            let fileHandle;
            try {
                fileHandle = await fs.open(tempPath, 'wx');
            } catch (error) {
                const statusCode = error.code === 'EEXIST' ? 503 : 500;
                return res.status(statusCode).json({ message: error.message });
            }

            const writeStream = fileHandle.createWriteStream({ flush: true });

            const unlock_tempfile = async () => {
                await new Promise(resolve => writeStream.close(resolve));
                await fs.unlink(tempPath).catch((err) => {
                    console.warn(`Failed to cleanup temp file ${tempPath}:`, err.message);
                 });
            };

            const fileExists = await fs.access(finalPath, fs.constants.F_OK)
                .then(() => true, () => false);
            if (fileExists) {
                await unlock_tempfile();
                return res.status(409).json({ message: `File with name ${filename} already exists.` });
            }

            this.log("Writing to temp file");

            const sizeLimit = getSizeTransform(MAX_FILE_SIZE);

            const [st, err] = await stream.promises.pipeline(req, sizeLimit, writeStream)
                .then(() => [201])
                .catch(e => [/^Stream exceeded maximum size/.test(e.message) ? 413 : 500, e]);

            if (st !== 201) {
                this.log("File upload failed: %o", err);
                await unlock_tempfile();
                return res.status(st).json({ message: err.message });
            }

            this.log("Renaming file.");
            await fs.rename(tempPath, finalPath);
            finalPathWritten = true;

            const cleanupFinalPath = async () => {
                if (finalPathWritten) {
                    try {
                        await fs.unlink(finalPath);
                        this.log(`Cleaned up orphaned file: ${finalPath}`);
                    } catch (e) {
                        this.log(`Failed to cleanup orphaned file: ${finalPath}`, e);
                    }
                }
            };

            if (!this.stateManager.hasSeenFile(finalPath)) {
                try {
                    await this.stateManager.addSeenFile(finalPath);

                    this.eventManager.emit('file:ready', { filePath: finalPath });

                    return res.status(201).json({
                        message: 'File uploaded successfully to the driver.',
                        filename: filename,
                    });
                } catch (err) {
                    await cleanupFinalPath();
                    console.error(`Failed to persist state for file ${finalPath}:`, err);
                    return res.status(500).json({ error: err.message });
                }
            }

            return res.status(200).json({ message: 'File already seen.' });

        } catch (err) {
            if (finalPathWritten && finalPath) {
                try {
                    await fs.unlink(finalPath);
                } catch (_) {}
            }
            return res.status(500).json({ error: err.message });
        }
    }

}