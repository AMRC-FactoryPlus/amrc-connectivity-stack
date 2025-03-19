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

      if (!Valid.uuid.test(file_uuid)) return res.status(410).end();

      // Check auth permission
      // Todo: disable wildcard in the future
      // Todo: update Target to be individual File, at the moment it checks if Principal has Download permission to the whole FileType object under which all Files are stored.
      const ok = await this.auth.check_acl(
        req.auth,
        Perm.Download,
        Class.FileType,
        true
      );

      if (!ok) return res.status(403).end();

      const fileObj = await this.configDb.get_config(App.Config, file_uuid);

      // File not found in ConfigDb
      if (!fileObj || !fileObj.file_uuid) {
        return res.status(404).json({ message: 'File not found in ConfigDb' });
      }

      return res
        .status(200)
        .download(process.env.FILES_STORAGE + '/' + file_uuid, (err) => {
          if (err) {
            console.error('Error: File download failed:', err);
          } else {
            console.log('File downloaded successfully.');
          }
        });
    } catch (err) {
      console.error('Error when getting file: ', err.message);
      res.status(500).end();
    }
  };

  postFile = async (req, res) => {
    try {
      const file_type_uuid = req.params.file_type_uuid;
      if (!Valid.uuid.test(file_type_uuid))
        return res.status(410).json({ message: 'file type uuid is invalid' });

      if (!this.isFileTypeSupported(file_type_uuid)) {
        return res.status(400).json({ message: 'File Type is not supported.' });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const file_uuid = req.file.filename;
      console.log('File uploaded to storage with filename: ', file_uuid);

      if (!Valid.uuid.test(file_uuid))
        return res
          .status(410)
          .json({ message: 'filename is not a valid uuid.' });

      // Todo: disable wildcard in the future.
      // Check ACL exists for the Principal to Upload to FileType. This means that the uploaded file objects will be stored under FileType (Rank2) object.
      const ok = await this.auth.check_acl(
        req.auth,
        Perm.Upload,
        Class.FileType,
        true
      );

      if (!ok) return res.status(403).end();

      // Create File object of File class with UUID generated during file upload
      const created_uuid = await this.configDb.create_object(
        Class.File,
        file_uuid,
        true
      );

      if (created_uuid !== file_uuid) {
        console.error(
          `ConfigDb ignored the provided file_uuid [${file_uuid}] and created a new one [${created_uuid}]`
        );
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
      console.log('Put to config completed.');
      return res.status(201).json({ message: 'File uploaded successfully' });
    } catch (err) {
      console.error('Error when posting file: ', err.message);
      res.status(500).end();
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
