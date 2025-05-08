import express from 'express';
import { App, Class, Perm, Special } from './constants.js';
import fs from 'fs'
import path from 'path';
import {parseSize} from "./parseSize.js";
import { UUIDs } from "@amrc-factoryplus/service-client";

const Valid = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

const MAX_FILE_SIZE = parseSize(process.env.BODY_LIMIT || '10GB');

export class APIv1 {
  constructor(opts) {
    this.configDb = opts.fplus.ConfigDB;
    this.auth = opts.fplus.Auth;
    this.fplus = opts.fplus;
    this.uploadPath = opts.uploadPath;
    this.routes = express.Router();
    this.setup_routes();
  }

  setup_routes() {
    let api = this.routes;
    api.get('/:uuid', this.get_file_by_uuid.bind(this));
    api.get('/', this.list_storage.bind(this));
    api.put('/:uuid', this.put_file_by_uuid.bind(this));
    api.post('/', this.post_file.bind(this));
  }

  async list_storage(req, res) {
    const ok = await this.auth.check_acl(
      req.auth,
      Perm.ListStorage,
      Special.Null,
      false
    );

    if (!ok)
      return res
        .status(403)
        .json({ message: 'FAILED: No ListStorage Permission' });

    const files = await fs.promises.readdir(this.uploadPath);

    return res.json({ files });
  }

  async get_file_by_uuid(req, res, next) {
    const file_uuid = req.params.uuid;

    if (!file_uuid)
      return res
        .status(400)
        .json({ message: 'FAILED: File Uuid not provided.' });

    if (!Valid.uuid.test(file_uuid))
      return res.status(410).json({ message: 'FAILED: File Uuid is invalid' });

    const ok = await this.auth.check_acl(
      req.auth,
      Perm.Download,
      file_uuid,
      true
    );

    if (!ok)
      return res
        .status(403)
        .json({ message: 'FAILED: No Download permission' });

    const file_path = path.resolve(this.uploadPath, file_uuid);

    const options = {
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-timestamp': Date.now(),
        'x-sent': true,
      },
    };

    return res.sendFile(file_path, options, function (err) {
      if (err) {
        if (err.code === 'ENOENT') {
          return res.status(404).json({ message: 'File not found' });
        }
        next(err);
      }
    });
  }

  async put_file_by_uuid(req, res, next) {
    // Check the client has permission.
    const ok = await this.auth.check_acl(
        req.auth,
        Perm.Upload,
        Special.Null,
        false
    );

    if (!ok) {
      return res.status(403).json({ message: 'FAILED: No Upload permission' });
    }

    // Check we have a UUID to work with.
    const file_uuid = req.params.uuid;
    if (!file_uuid){
      return res.status(400).json({ message: 'FAILED: File Uuid not provided.' });
    }

    // check the file object uuid exists.
    const exists = await this.configDb.class_has_member(Class.File, file_uuid);
    if(!exists){
      return res.status(404).json({ message: 'FAILED: File object not found.' });
    }

    // check if the file already exists.
    const file_path = path.resolve(this.uploadPath, file_uuid);
    // Temporary path to use while writing to disk.
    const temp_path = path.resolve(this.uploadPath, `${file_path}_TEMP_${Date.now()}"`);

    try {
      await fs.promises.access(file_path, fs.constants.R_OK);
      return res.status(409).json({ message: `FAILED: File with the UUID ${file_uuid} already exists.` });
    } catch(e) {
      console.log(`No file with UUID ${file_uuid} exists. Continuing.`);
    }

    // write the file.
    await fs.promises.mkdir(this.uploadPath, { recursive: true });
    const write_stream = fs.createWriteStream(temp_path);

    let total_bytes = 0;
    let aborted = false;
    let receivedData = false;

    req.on('data', (chunk) => {
      total_bytes += chunk.length;
      receivedData = true;

      // Check size limit before writing
      if (total_bytes > MAX_FILE_SIZE && !aborted) {
        aborted = true;
        write_stream.end();

        // Clean up the incomplete file
        fs.unlink(temp_path, (err) => {
          if (err) console.error('Failed to delete incomplete file:', err);
        });

        return res.status(413).json({
          message: 'File exceeded maximum file size'
        });
      }

      // Only write if we haven't aborted
      if (!aborted) {
        // Handle backpressure
        const canContinue = write_stream.write(chunk);
        if (!canContinue) {
          req.pause();
        }
      }
    });

    // Resume once the write buffer has been emptied.
    write_stream.on('drain', () => {
      req.resume();
    });

    req.on('end', async () => {
      // If the "data" event hasn't fired, nothing's been written.
      if(!receivedData){
        return res.status(400).json({ message: 'No file uploaded' });
      }

      if (!aborted) {
        write_stream.end();
        // Rename the temporary file now it's written to disk.
        await fs.promises.rename(temp_path, file_path);
        const stats = await fs.promises.stat(file_path);
        const curr_date = new Date();
        const original_file_name = req.headers['original-filename'] || null;

        // write any additional metadata.
        let file_JSON = {
          file_uuid: file_uuid,
          date_uploaded: curr_date,
          user_who_uploaded: req.auth,
          file_size: stats.size,
          original_file_name: original_file_name,
        };

        // Store the file config under App 'Files Configuration'
        await this.configDb.put_config(App.Config, file_uuid, file_JSON);

        return res.status(201).json({
          message: 'File uploaded successfully.',
          uuid: file_uuid,
        });
      }
    });

    req.on('error', (err) => {
      write_stream.end();
      fs.unlink(temp_path, () => {});
      return res.status(500).json({ message: 'Upload failed', error: err.message });
    });

    write_stream.on('error', (err) => {
      aborted = true;
      fs.unlink(temp_path, () => {});
      return res.status(500).send('Error uploading file: ' + err.message);
    });
  }

  async post_file(req, res) {
    return res.status(410).json({ message: 'End point gone!' });
  }
}
