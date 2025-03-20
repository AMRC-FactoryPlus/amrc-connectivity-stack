import express from 'express';
import { App, Class, Perm } from './constants.js';
import fs from 'fs';
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
    api.get('/', this.getFiles.bind(this));
    api.post('/', this.postFile.bind(this));
  }

  async getFiles(req, res) {
    // Only for admins
    const ok = await this.auth.check_acl(req.auth, Perm.All, App.Config, true);
    if (!ok)
      return res.status(403).json({ message: 'FAILED: Not authorised.' });

    // return list of files from storage

    fs.readdir(this.uploadPath, (err, files) => {
      if (err) {
        return res
          .status(500)
          .json({ message: 'FAILED: Error accessing files' });
      }

      return res.json({ files }); // Return list of file names
    });
  }

  async getFileByUuid(req, res) {
    try {
      const file_uuid = req.params.uuid;

      if (!file_uuid)
        return res
          .status(400)
          .json({ message: 'FAILED: File Uuid not provided.' });

      if (!Valid.uuid.test(file_uuid))
        return res
          .status(410)
          .json({ message: 'FAILED: File Uuid is invalid' });

      // Check auth permission
      // Todo: disable wildcard in the future
      // Todo: update Target to be individual File, at the moment it checks if Principal has Download permission to the whole FileType object under which all Files are stored.
      const ok = await this.auth.check_acl(
        req.auth,
        Perm.Download,
        App.Config,
        true
      );

      if (!ok)
        return res
          .status(403)
          .json({ message: 'FAILED: No Download permission' });

      const filePath = path.join(this.uploadPath, file_uuid);

      // Check if file exists
      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
          return res.status(404).json({ message: 'FAILED: File not found' });
        }

        // File exists, proceed with download
        return res.status(200).download(filePath, (err) => {
          if (err) {
            res.status(500).json({ message: 'FAILED: Error downloading file' });
          }
        });
      });
    } catch (err) {
      return res.status(500).json(err.message);
    }
  }

  async postFile(req, res) {
    try {
      // Todo: disable wildcard in the future.
      // Check ACL exists for the Principal to Upload to FileType. This means that the uploaded file objects will be stored under FileType (Rank2) object.

      const ok = await this.auth.check_acl(
        req.auth,
        Perm.Upload,
        App.Config,
        true
      );

      if (!ok) {
        return res.status(403).json({
          message: 'FAILED: No Upload permission',
        });
      }

      // Create object in ConfigDB of Class File
      const created_uuid = await this.configDb.create_object(Class.File);

      // Upload file to Storage

      fs.mkdirSync(this.uploadPath, { recursive: true });
      const file_path = path.join(this.uploadPath, created_uuid);

      fs.writeFile(file_path, req.body, async (err) => {
        if (err) {
          res.status(500).json({ message: 'FAILED: File upload failed.' });
        }

        const stats = fs.statSync(file_path); // to get file size

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
        await this.configDb.put_config(App.Config, file_uuid, fileJSON);

        return res.status(201).json({
          message: 'OK. File uploaded to storage and its metadata to ConfigDB.',
        });
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
}
