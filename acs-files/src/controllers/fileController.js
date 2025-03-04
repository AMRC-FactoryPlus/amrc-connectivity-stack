export const getFile = (req, res) => {
  const file_uuid = req.params.file_uuid;

  // retrieve the file with name equal to file_uuid from the storage

  // return the actual file

  console.log(req.params);
  return res.json({ uuid: req.params.uuid });
};

export const postFile = (req, res) => {
  const file_type_uuid = req.params.file_type_uuid;
  console.log('file type uuid: ', file_type_uuid);
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  res.json({
    message: 'File uploaded successfully',
    filename: req.file.filename,
  });

  // upload file to storage
  // capture current datetime
  // create object with FileSchema
  // store the object in ACS Config Service
};
