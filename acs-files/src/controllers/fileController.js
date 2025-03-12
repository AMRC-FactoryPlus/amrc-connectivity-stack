import fs from 'node:fs';
import axios from 'axios';
import * as dotenv from "dotenv";
import { ServiceClient } from '@amrc-factoryplus/service-client';
import { ConfigDB } from '@amrc-factoryplus/service-client/lib/interfaces.js';
dotenv.config({});

const sc = await new ServiceClient({ env: process.env }).init();
const configDBObj = new ConfigDB(sc);
// let configTest = await configDBObj.list_configs("64a8bfa9-7772-45c4-9d1a-9e6290690957"); //configRes.get_config(process.env.GENOBJINFO_APP, process.env.FILE_CLASS_UUID); 
// console.log("configRes:");
// console.log(configTest);



export const getFile = async (req, res) => {
  const file_uuid = req.params.file_uuid;
  let url = process.env.CONFIGDB + "/v1/app/" + process.env.GENOBJINFO_APP + "/object/" + process.env.FILE_CLASS_UUID;
  // console.log("Endpoint: " + url);
  // console.log("Username: " + process.env.UNAME + "  Password:" + process.env.PASSWORD);
  let fileObj = await configDBObj.get_config(process.env.FILE_SERVICE_APP_UUID, file_uuid);
  console.log("File UUID");
  console.log(fileObj);
  
  if (!fileObj) {
    // array does not exist, is not an array, or is empty
    // ⇒ do not attempt to process array
    return res.status(404).json({ message: 'No file was found' })
  }
  else{
    console.log("File was found!");
    //  //If file uuid is found, return file
    // fs.readFile('./uploads/' + file_uuid + ".txt", 'utf-8',(err, data) => {
    //   if (err) {
    //     console.error(err);
    //     return;
    //   }

    //   console.log(req.params);
    //   console.log("File is: ");
    //   console.log(data);
    
    //   //return res.json({ uuid: req.params.uuid, file: data });

    
    // });

    // //Defaulting to text files for testing
    // return res.download("./uploads/" + file_uuid + ".txt", (err) => {
    //   if (err) {
    //     console.error('File download failed:', err);
    //   } else {
    //     console.log('File downloaded successfully.');
    //   }
    // });
  }

 

  // retrieve the file with name equal to file_uuid from the storage

  // return the actual file

 
};

export const postFile = async (req, res) => {
  const file_type_uuid = req.query.file_type_uuid;


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

  //console.log(req);
  //return;
  console.log('file type uuid: ', file_type_uuid);
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  // res.json({
  //   message: 'File uploaded successfully',
  //   filename: req.file.filename + ".txt",
  // });

 

  // upload file to storage
  // capture current datetime
  // create object with FileSchema
  // store the object in ACS Config Service

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
  // let url = process.env.CONFIGDB + "/v1/object";
  // axios.post(url, {
  //   class: process.env.TXT_TYPE_UUID, 
  //   uuid: req.file.filename,
  //   name: req.file.originalname
  //   }, {
  //   auth: {
  //     username: process.env.UNAME,
  //     password: process.env.PASSWORD
  //   }

  //   }).then(function (response) {
  //     // handle success
  //     console.log("Post to configDB successful!");
  //     console.log(response);

      
  //   })
  //   .catch(function (error) {
  //     console.log("THis is an error.");
  //     // handle error
  //     console.log(error);
  //  });

   

    //let configTest = configRes.create_object (process.env.TXT_TYPE_UUID, req.file.filename);
};




export const helloRes = (req, res) => {
   
  
    // retrieve the file with name equal to file_uuid from the storage
  
    // return the actual file
  
    console.log("Hello Route Requested");
    return res.json({ hello: "Hello!" });
  };