import express from 'express';
import { App, Class, Perm } from './constants.js';
import { promises as fs } from 'fs';
import path from 'path';

const Valid = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

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

    api.get('/:uuid', this.getFileByUuid.bind(this));
    api.get('/', this.listStorage.bind(this));
    api.post('/', this.postFile.bind(this));
  }

  async listStorage(req, res) {
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

  async getFileByUuid(req, res, next) {
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

    const filePath = path.resolve(this.uploadPath, file_uuid);

    const options = {
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-timestamp': Date.now(),
        'x-sent': true,
      },
    };

    return res.sendFile(filePath, options, function (err) {
      if (err) {
        if (err.code === 'ENOENT') {
          return res.status(404).json({ message: 'File not found' });
        }
        next(err);
      }
    });
  }

  async postFile(req, res) {
    const ok = await this.auth.check_acl(
      req.auth,
      Perm.Upload,
      Special.Null,
      false
    );

    if (!ok) {
      return res.status(403).json({ message: 'FAILED: No Upload permission' });
    }

    const created_uuid = await this.configDb.create_object(Class.File);

    // Ensure uploadPath exists
    await fs.mkdir(this.uploadPath, { recursive: true });

    const file_path = path.resolve(this.uploadPath, created_uuid);

    await fs.writeFile(file_path, req.body);

    const stats = await fs.stat(file_path);

    const currDate = new Date();
    const original_file_name = req.headers['x-filename'] || null;

    let fileJSON = {
      file_uuid: created_uuid,
      date_uploaded: currDate,
      user_who_uploaded: req.auth,
      file_size: stats.size,
      application_uuid: App.Config,
      original_file_name: original_file_name,
    };

    // Store the file config under App 'Files Configuration'
    await this.configDb.put_config(App.Config, created_uuid, fileJSON);

    return res.status(201).json({
      message: 'OK. File uploaded to storage and its metadata to ConfigDB.',
    });
  }
}
