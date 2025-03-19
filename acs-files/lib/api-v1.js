import * as dotenv from 'dotenv';
import express from 'express';
import { App, Class, FileType, Perm } from './constants.js';

dotenv.config({});

const Valid = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

export class APIv1 {
  constructor(opts) {
    this.configDb = opts.configDb;
    this.auth = opts.auth;
    this.upload = opts.upload;
    this.routes = express.Router();
    this.setup_routes();
  }

  setup_routes() {
    let api = this.routes;

    api.get('/:file_uuid', this.getFile.bind(this));
    api.post(
      '/:file_type_uuid',
      this.upload.single('file'),
      this.postFile.bind(this)
    );
  }

  getFile = async (req, res) => {
    try {
      const file_uuid = req.params.file_uuid;

      if (!file_uuid)
        return res.status(400).json({ message: 'file_uuid not provided.' });

      if (!Valid.uuid.test(file_uuid))
        return res.status(410).json({ message: 'file_uuid is invalid' });

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
          .json({ message: 'Do not have Download permission' });

      return res
        .status(200)
        .download(process.env.FILES_STORAGE + '/' + file_uuid, (err) => {
          if (err) {
            throw err;
          }
        });
    } catch (err) {
      return res.status(500).json(err.message);
    }
  };

  postFile = async (req, res) => {
    try {
      const file_type_uuid = req.params.file_type_uuid;

      if (!file_type_uuid)
        return res
          .status(400)
          .json({ message: 'File type uuid is not provided.' });

      if (!Valid.uuid.test(file_type_uuid))
        return res.status(410).json({ message: 'file type uuid is invalid' });

      if (!this.isFileTypeSupported(file_type_uuid)) {
        return res.status(400).json({ message: 'File Type is not supported.' });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const file_uuid = req.file.filename;

      if (!Valid.uuid.test(file_uuid))
        return res
          .status(410)
          .json({ message: 'filename is not a valid uuid.' });

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
          message: 'Does not have permission to Upload',
        });
      }

      // Create File object of File class with UUID generated during file upload, True means fail if object already exists

      const created_uuid = await this.configDb.create_object(
        Class.File,
        file_uuid,
        true
      );

      if (created_uuid !== file_uuid) {
        return res.status(500).json({
          message:
            "Newly created file object's uuid is not the same as provided.",
        });
      }

      const currDate = new Date();

      let fileJSON = {
        file_uuid: file_uuid,
        file_type_uuid: file_type_uuid,
        date_uploaded: currDate,
        user_who_uploaded: process.env.USER_ACCOUNT_UUID,
        file_size: req.file.size,
        application_uuid: App.Config,
      };

      // Store the file config under App 'Files Configuration'
      await this.configDb.put_config(App.Config, file_uuid, fileJSON);

      return res.status(201).json({
        message: 'File uploaded successfully and its metadata put to ConfigDB.',
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  };

  isFileTypeSupported(file_type_uuid) {
    return (
      file_type_uuid === FileType.TXT ||
      file_type_uuid === FileType.CSV ||
      file_type_uuid === FileType.PDF ||
      file_type_uuid === FileType.CAD
    );
  }
}
