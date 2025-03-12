import fs from 'node:fs';
import axios from 'axios';

//using axios to test F+ endpoints while running this code locally.
//Once this is integrated with fpd-bender this will likely be refactored

export const getFile = (req, res) => {
  const file_uuid = req.params.file_uuid;
  let url =
    process.env.CONFIGDB +
    '/v1/app/' +
    process.env.GENOBJINFO_APP +
    '/object/' +
    process.env.FILE_CLASS_UUID;
  console.log('Endpoint: ' + url);
  console.log(
    'Username: ' + process.env.UNAME + '  Password:' + process.env.PASSWORD
  );

  //Testing that I can get uuids from configDB
  axios
    .get(url, {
      auth: {
        username: process.env.UNAME,
        password: process.env.PASSWORD,
      },
    })
    .then(function (response) {
      // handle success
      console.log('axios success');

      if (response.data.name == 'File') {
      }
    })
    .catch(function (error) {
      console.log('THis is an error.');
      // handle error
      console.log(error);
    });

  //If file uuid is found, return file
  fs.readFile('./uploads/' + file_uuid + '.txt', 'utf-8', (err, data) => {
    if (err) {
      console.error(err);
      return;
    }

    console.log(req.params);
    console.log('File is: ');
    console.log(data);

    //return res.json({ uuid: req.params.uuid, file: data });
  });

  //Defaulting to text files for testing
  return res.download('./uploads/' + file_uuid + '.txt', (err) => {
    if (err) {
      console.error('File download failed:', err);
    } else {
      console.log('File downloaded successfully.');
    }
  });

  // retrieve the file with name equal to file_uuid from the storage

  // return the actual file
};

export const postFile = (req, res) => {
  const file_type_uuid = req.params.file_type_uuid;

  //Check for File Type

  console.log(req);
  //return;
  console.log('file type uuid: ', file_type_uuid);
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  res.json({
    message: 'File uploaded successfully',
    filename: req.file.filename + '.txt',
  });

  // upload file to storage
  // capture current datetime
  // create object with FileSchema
  // store the object in ACS Config Service

  let url = process.env.CONFIGDB + '/v1/object';
  axios
    .post(
      url,
      {
        class: process.env.TXT_TYPE_UUID,
        uuid: req.file.filename,
        name: req.file.originalname,
      },
      {
        auth: {
          username: process.env.UNAME,
          password: process.env.PASSWORD,
        },
      }
    )
    .then(function (response) {
      // handle success
      console.log('Post to configDB successful!');
      console.log(response);
    })
    .catch(function (error) {
      console.log('THis is an error.');
      // handle error
      console.log(error);
    });
};

export const helloRes = async (req, res) => {
  console.log('/hello triggered');
  
  const configDB = req.configDb;
  const list_configs = await configDB.list_configs(
    'f8c1b13b-ebaf-45c9-b712-9cd712695513'
  );
  console.log(list_configs);
  return res.json(list_configs);
};
