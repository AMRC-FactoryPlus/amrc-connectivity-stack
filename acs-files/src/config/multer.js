import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

// Multer configuration

// file name should be file_uuid
export const multer_storage = multer.diskStorage({
  destination: './uploads', // updated to the Persistent Volume in fpd-bender, which serves the pod file-service-test-pod
  //destination: '/mnt/disks/ssd1', // updated to the Persistent Volume in fpd-bender, which serves the pod file-service-test-pod
  //put this location in an env variable

  filename: (req, file, cb) => {
    const file_uuid = uuidv4();
    cb(null, file_uuid);
  },
});
