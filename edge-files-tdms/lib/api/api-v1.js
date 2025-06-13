import express from 'express';
import fs from 'node:fs/promises'
import path from 'path';
import {parseSize} from "./parseSize.js";
import streamSize  from "stream-size";
const getSizeTransform = streamSize.default;
import * as stream from "node:stream";

const MAX_FILE_SIZE = parseSize(process.env.BODY_LIMIT || '10GB');

export class APIv1 {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.auth = this.fplus.Auth;
        this.log = this.fplus.debug.bound("api-v1");
        this.uploadPath = opts.uploadPath;
        this.routes = express.Router();
        this.setup_routes();
    }

    setup_routes() {
        let api = this.routes;
        api.post('/', this.post_file.bind(this));
    }

    async post_file(req, res) {
        const filename = req.params.filename;

        if(!filename){
            return res.status(400).json({message: 'Filename is required.'});
        }


        // Check we have a UUID to work with.
        const fileName = req.params.filename;
        if (!fileName){
            return res.status(404).json({ message: 'FAILED: File Name not provided.' });
        }

        const filePath = path.resolve(this.uploadPath, filename);
        // Temporary path to use while writing to disk.
        const tempPath = path.resolve(this.uploadPath, `${filename}.temp`);

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
        const fileExists = await fs.access(filePath, fs.constants.F_OK)
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
        await fs.rename(tempPath, filePath);
            return res.status(201).json({
                message: 'File uploaded successfully.',
                filename: filename,
        });
    }
}