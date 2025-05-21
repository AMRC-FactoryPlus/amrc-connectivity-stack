import express from 'express';
import { App, Class, Perm, Special } from './constants.js';
import fs from 'node:fs/promises'
import path from 'path';
import {parseSize} from "./parseSize.js";
import streamSize  from "stream-size";
const getSizeTransform = streamSize.default;
import * as stream from "node:stream";
const Valid = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

const MAX_FILE_SIZE = parseSize(process.env.BODY_LIMIT || '10GB');

export class APIv1 {
  constructor(opts) {
    this.fplus = opts.fplus;
    this.configDb = this.fplus.ConfigDB;
    this.auth = this.fplus.Auth;
    this.log = this.fplus.debug.bound("api-v1");
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

    const files = await fs.readdir(this.uploadPath);

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

  async put_file_by_uuid(req, res) {
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
      return res.status(404).json({ message: 'FAILED: File Uuid not provided.' });
    }

    // Check the file object uuid exists.
    const objectExists = await this.configDb.class_has_member(Class.File, file_uuid);
    if(!objectExists){
      return res.status(404).json({ message: 'FAILED: File object not found.' });
    }

    const file_path = path.resolve(this.uploadPath, file_uuid);
    // Temporary path to use while writing to disk.
    const temp_path = path.resolve(this.uploadPath, `${file_uuid}.temp`);

    await fs.mkdir(this.uploadPath, { recursive: true });

    // Check if the temporary file already exists.
    let fileHandle;
    try {
      fileHandle = await fs.open(temp_path, 'wx');
    } catch (error) {
      const statusCode = error.code === 'EEXIST' ? 503 : 500;
      return res.status(statusCode).json({ message: error.message });
    }

    const write_stream = fileHandle.createWriteStream({ flush: true });
    /* Now fileHandle belongs to the WriteStream; we mustn't touch it again */
    const unlock_tempfile = async () => {
      await new Promise(resolve => write_stream.close(resolve));
      await fs.unlink(temp_path);
    };

    // Check if the file already exists.
    const fileExists = await fs.access(file_path, fs.constants.F_OK)
        .then(() => true, () => false);
    if (fileExists){
      await unlock_tempfile();
      return res.status(409).json({ message: `File with UUID ${file_uuid} already exists.` });
    }
    this.log("Writing to temp file");
    const size_limit = getSizeTransform(MAX_FILE_SIZE);
    const [st, err] = await stream.promises.pipeline(req, size_limit, write_stream)
        .then(() => [201])
        .catch(e => [/^Stream exceeded maximum size/.test(e.message) ? 413 : 500, e]);
    if (st != 201) {
      this.log("File upload failed: %o", err);
      await unlock_tempfile();
      return res.status(st).json({ message: err.message });
    }

    const stats = await fs.stat(temp_path);
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

    try{
      this.log("Writing metadata to configDB")
      // Store the file config under App 'Files Configuration'
      await this.configDb.put_config(App.Config, file_uuid, file_JSON);
    }catch (e) {
      await unlock_tempfile();
      return res.status(503).send('Error uploading file: ' + e.message);
    }

    this.log("Renaming file.")
    // Rename the temporary file now it's written to disk.
    await fs.rename(temp_path, file_path);
    return res.status(201).json({
      message: 'File uploaded successfully.',
      uuid: file_uuid,
    });
  }

  async post_file(req, res) {
    return res.status(410).json({ message: 'End point gone!' });
  }
}
