import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from "dotenv";
dotenv.config({});

// Multer configuration

// file name should be file_uuid
export const multer_storage = multer.diskStorage({
  destination: process.env.FILES_STORAGE,

  filename: (req, file, cb) => {
    const file_uuid = uuidv4();
    cb(null, file_uuid);
  },
});
