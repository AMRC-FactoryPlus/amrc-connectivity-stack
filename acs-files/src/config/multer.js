import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

// Multer configuration

// file name should be file_uuid
export const multer_storage = multer.diskStorage({
  destination: './uploads', // update this to be kubernetes volume something like /mnt/files

  filename: (req, file, cb) => {
    const file_uuid = uuidv4();
    cb(null, file_uuid);
  },
});
