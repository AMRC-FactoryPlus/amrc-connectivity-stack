import express from 'express';
import { App, Class, Perm, Special } from './constants.js';
import fs from 'fs'
import path from 'path';
import {parseSize} from "./parseSize.js";
import { v4 as uuidv4 } from 'uuid';

const Valid = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

const MAX_FILE_SIZE = parseSize(process.env.BODY_LIMIT || '10GB');

export class APIv1 {
  constructor(opts) {
    this.configDb = opts.configDb;
    this.auth = opts.auth;
    this.uploadPath = opts.uploadPath;
    this.routes = express.Router();
    this.setup_routes();
  }

  setup_routes() {
    let api = this.routes;
    api.get('/:uuid', this.get_file_by_uuid.bind(this));
    api.get('/', this.list_storage.bind(this));
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

  async post_file(req, res) {
    const ok = await this.auth.check_acl(
      req.auth,
      Perm.Upload,
      Special.Null,
      false
    );

    if (!ok) {
      return res.status(403).json({ message: 'FAILED: No Upload permission' });
    }
    const file_uuid = uuidv4();
    await fs.promises.mkdir(this.uploadPath, { recursive: true });
    const file_path = path.resolve(this.uploadPath, file_uuid);
    const write_stream = fs.createWriteStream(file_path);

    let total_bytes = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      total_bytes += chunk.length;

      // Check size limit before writing
      if (total_bytes > MAX_FILE_SIZE && !aborted) {
        aborted = true;
        write_stream.end();

        // Clean up the incomplete file
        fs.unlink(file_path, (err) => {
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

    write_stream.on('drain', () => {
      req.resume();
    });

    req.on('end', async () => {
      if (!aborted) {
        write_stream.end();
        const stats = await fs.promises.stat(file_path);
        const curr_date = new Date();
        const original_file_name = req.headers['original-filename'] || null;

        let file_JSON = {
          file_uuid: file_uuid,
          date_uploaded: curr_date,
          user_who_uploaded: req.auth,
          file_size: stats.size,
          original_file_name: original_file_name,
        };

        await this.configDb.create_object(Class.File, file_uuid);
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
      fs.unlink(file_path, () => {});
      res.status(500).json({ message: 'Upload failed', error: err.message });
    });

    write_stream.on('error', (err) => {
      aborted = true;
      fs.unlink(file_path, () => {});
      return res.status(500).send('Error uploading file: ' + err.message);
    });
  }
}
