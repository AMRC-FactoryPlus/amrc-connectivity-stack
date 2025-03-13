import fs from 'node:fs';
import * as dotenv from "dotenv";
import { ServiceClient } from '@amrc-factoryplus/service-client';
import { ConfigDB } from '@amrc-factoryplus/service-client/lib/interfaces.js';
dotenv.config({});

const sc = await new ServiceClient({ env: process.env }).init();
const configDBObj = new ConfigDB(sc); //Setup configDB object for adding/editing file uuid entries

// export const getFilesByType = async(req, res) => {
//   const file_uuid = req.params.file_type;
//   let fileObj;

//   if(file_uuid == process.env.TXT_TYPE_UUID)
//   {
//     fileObj = await configDBObj.class_members(process.env.TXT_TYPE_UUID);
//   }else if(file_uuid == process.env.PDF_TYPE_UUID)
//   {
//     fileObj = await configDBObj.class_members(process.env.PDF_TYPE_UUID);
//   } else if(file_uuid == process.env.CAD_TYPE_UUID)
//   {
//     fileObj = await configDBObj.class_members(process.env.CAD_TYPE_UUID);
//   } else
//   {
//     return res(404).json({message: "No file type was found"});
//   }

//   console.log(fileObj);

//   return res.status(201).json({fileObj}); //returns array of file uuids of that type

// }

export const getFile = async (req, res) => {
  const file_uuid = req.params.file_uuid;
  
  let fileObj = await configDBObj.get_config(process.env.FILE_SERVICE_APP_UUID, file_uuid);
  console.log("File UUID");
  console.log(fileObj);
  
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
    

    return res.status(201).download(process.env.FILES_STORAGE + '/' + file_uuid, (err) => {
      if (err) {
        console.error('File download failed:', err);
      } else {
        console.log('File downloaded successfully.');
      }
    });
  }


 
};

export const postFile = async (req, res) => {
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

  console.log(fileJSON);

  //Check for File Type

  console.log('file type uuid: ', file_type_uuid);
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  if(file_type_uuid == process.env.TXT_TYPE_UUID)
  {
    let fileObj = await configDBObj.create_object(process.env.TXT_TYPE_UUID, req.file.filename); 

    console.log("fileObj");
    console.log(fileObj);

  }else if (file_type_uuid == process.env.PDF_TYPE_UUID)
  {
    let fileObj = await configDBObj.create_object(process.env.PDF_TYPE_UUID, req.file.filename); 

    console.log("fileObj");
    console.log(fileObj);
  }else
  {
    return res.status(400).json({message: 'File type is unsupported'});
  }

  let fileConfig = await configDBObj.put_config(process.env.FILE_SERVICE_APP_UUID, req.file.filename, fileJSON);

  return res.status(201).json({message:'File uploaded successfully'});
 
};




export const helloRes = (req, res) => {
  
    // test to make sure API is responding
    console.log("Hello Route Requested");
    return res.json({ hello: "Hello!" });
};