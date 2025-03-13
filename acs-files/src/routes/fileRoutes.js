import express from 'express';
import { getFile, postFile, helloRes, getFilesByType } from '../controllers/fileController.js';
import { multer_storage } from '../config/multer.js';
import multer from 'multer';

const upload = multer({ storage: multer_storage });

const router = express.Router();

// GET /v1/file/:uuid
router.get('/hello', helloRes);

router.get('/list/:file_type', getFilesByType);

// GET /v1/file/:uuid
router.get('/:file_uuid', getFile);

// POST /v1/file/:type
router.post('/:file_type_uuid', upload.single('file'), postFile);

export default router;
