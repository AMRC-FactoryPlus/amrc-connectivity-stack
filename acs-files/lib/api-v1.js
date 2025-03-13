import fs from 'node:fs';
import axios from 'axios';
import express from 'express';

import { App, Class, FileTypes, Perm } from './constants.js';

const Valid = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

//using axios to test F+ endpoints while running this code locally.
//Once this is integrated with fpd-bender this will likely be refactored

export class APIv1 {
  constructor(opts) {
    this.configDb = opts.configDb;
    this.auth = opts.auth;

    this.multer = opts.multer;

    this.routes = express.Router();

    this.setup_routes();
  }

  setup_routes() {
    let api = this.routes;

    api.get('/:file_uuid', this.getFile.bind(this));
    api.post(
      '/:file_type_uuid',
      upload.single('file'),
      this.postFile.bind(this)
    );
  }

  getFile = async (req, res) => {
    // Check for Download permission
    const ok = await this.auth.check_acl(
      req.auth,
      Perm.Download,
      Class.FileType,
      true
    );

    if (!ok) return res.status(403).end();


    

    return res.status(200).json({ authForDownload: true });
  };

  postFile = async (req, res) => {
    const ok = await this.auth.check_acl(
      req.auth,
      Perm.Upload,
      FileTypes.PDF,
      true
    );

    if (!ok) return res.status(403).end();

    return res.status(200).json({ authForUpload: true });
  };

  retrieveFileFromStorage = async () => {
    // const file_uuid = req.params.file_uuid;
    // let url =
    //   process.env.CONFIGDB +
    //   '/v1/app/' +
    //   process.env.GENOBJINFO_APP +
    //   '/object/' +
    //   process.env.FILE_CLASS_UUID;
    // console.log('Endpoint: ' + url);
    // console.log(
    //   'Username: ' + process.env.UNAME + '  Password:' + process.env.PASSWORD
    // );
    // //Testing that I can get uuids from configDB
    // axios
    //   .get(url, {
    //     auth: {
    //       username: process.env.UNAME,
    //       password: process.env.PASSWORD,
    //     },
    //   })
    //   .then(function (response) {
    //     // handle success
    //     console.log('axios success');
    //     if (response.data.name == 'File') {
    //     }
    //   })
    //   .catch(function (error) {
    //     console.log('THis is an error.');
    //     // handle error
    //     console.log(error);
    //   });
    // //If file uuid is found, return file
    // fs.readFile('./uploads/' + file_uuid + '.txt', 'utf-8', (err, data) => {
    //   if (err) {
    //     console.error(err);
    //     return;
    //   }
    //   console.log(req.params);
    //   console.log('File is: ');
    //   console.log(data);
    //   //return res.json({ uuid: req.params.uuid, file: data });
    // });
    // //Defaulting to text files for testing
    // return res.download('./uploads/' + file_uuid + '.txt', (err) => {
    //   if (err) {
    //     console.error('File download failed:', err);
    //   } else {
    //     console.log('File downloaded successfully.');
    //   }
    // });
  };

  upload_file_to_storage = async () => {
    // const file_type_uuid = req.params.file_type_uuid;
    // //Check for File Type
    // console.log(req);
    // //return;
    // console.log('file type uuid: ', file_type_uuid);
    // if (!req.file) {
    //   return res.status(400).json({ message: 'No file uploaded' });
    // }
    // res.json({
    //   message: 'File uploaded successfully',
    //   filename: req.file.filename + '.txt',
    // });
    // // upload file to storage
    // // capture current datetime
    // // create object with FileSchema
    // // store the object in ACS Config Service
    // let url = process.env.CONFIGDB + '/v1/object';
    // axios
    //   .post(
    //     url,
    //     {
    //       class: process.env.TXT_TYPE_UUID,
    //       uuid: req.file.filename,
    //       name: req.file.originalname,
    //     },
    //     {
    //       auth: {
    //         username: process.env.UNAME,
    //         password: process.env.PASSWORD,
    //       },
    //     }
    //   )
    //   .then(function (response) {
    //     // handle success
    //     console.log('Post to configDB successful!');
    //     console.log(response);
    //   })
    //   .catch(function (error) {
    //     console.log('THis is an error.');
    //     // handle error
    //     console.log(error);
    //   });
  };
}
