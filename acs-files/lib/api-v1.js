import fs from 'node:fs';
import axios from 'axios';
import * as dotenv from "dotenv";
import express from 'express';
import { App, Class, FileTypes, Perm } from './constants.js';
dotenv.config({});

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

    this.retrieveFileFromStorage(req, res);
    

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

    this.upload_file_to_storage(req, res);

    return res.status(200).json({ authForUpload: true });
  };

  retrieveFileFromStorage = async (req,res) => {
    const file_uuid = req.params.file_uuid;
  
    let fileObj = await this.configDBObj.get_config(process.env.FILE_SERVICE_APP_UUID, file_uuid);
    
    if (!fileObj.file) {
      // no file uuid means no file was found
      return res.status(404).json({ message: 'No file was found' })
    }
    else{
      let resFileType;
      //Set file extension to make it easier to download in the correct format later
      if(fileObj.file_type == process.env.TXT_TYPE_UUID)
      {
        resFileType = ".txt";
      }else if(fileObj.file_type == process.env.PDF_TYPE_UUID)
      {
        resFileType = ".pdf";
      }else if(fileObj.file_type == process.env.CAD_TYPE_UUID)
      {
        resFileType = ".cad";
      }
      

      return res.status(200).download(process.env.FILES_STORAGE + '/' + file_uuid, (err) => {
        if (err) {
          console.error('File download failed:', err);
        } else {
          console.log('File downloaded successfully.');
        }
      });
    }
   
  };

  upload_file_to_storage = async (req, res) => {
    const file_type_uuid = req.query.file_type_uuid; //Get File type based on UUID 

    /*
    Store the file object in config db as follows:

      file uuid
      file type uuid
      date uploaded
      user who uploaded
      file size ?
      application uuid 
    */
    let fileJSON = {
      "name": req.file.originalname,
      "file": req.file.filename,
      "file_type": req.params.file_type_uuid,
      "date_uploaded": new Date(),
      "uploader": process.env.USER_ACCOUNT_UUID
    };

    //Check for File Type

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    if(file_type_uuid == process.env.TXT_TYPE_UUID)
    {
      let fileObj = await this.configDb.create_object(process.env.TXT_TYPE_UUID, req.file.filename); 

      console.log("fileObj");
      console.log(fileObj);

    }else if (file_type_uuid == process.env.PDF_TYPE_UUID)
    {
      let fileObj = await this.configDb.create_object(process.env.PDF_TYPE_UUID, req.file.filename); 

      console.log("fileObj");
      console.log(fileObj);
    }else
    {
      return res.status(400).json({message: 'File type is unsupported'});
    }

    let fileConfig = await this.configDb.put_config(process.env.FILE_SERVICE_APP_UUID, req.file.filename, fileJSON);

    return res.status(201).json({message:'File uploaded successfully'});
    
  };
}
