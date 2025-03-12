import express from 'express';
import cors from 'cors';
import fileRouter from './routes/fileRoutes.js';
import { ServiceClient } from '@amrc-factoryplus/service-client';
import { ConfigDB } from '@amrc-factoryplus/service-client/lib/interfaces.js';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();

const fPlus = await new ServiceClient({ env: process.env }).init();
const configDb = new ConfigDB(fPlus);

/**
 * - Do I/Bradley need to create a cluster or just node in manager. If yes, in hermes, it's stuck
 *
 * - Create file types class
 * - Create file type objects for PDF, CSV, etc
 * - Store file type objects' uuids in project
 *
 * - Create upload permission
 * - Create download permission
 * - Create ACL for File Service Node (principal) to Upload (permission) to Files App?
 * - Create ACL for Files Service Node to Download from Files App?
 *
 *
 */

// Middleware
app.use((req, res, next) => {
  req.configDb = configDb;
  next();
});

app.use(express.json());
app.use(cors());

// Routes
app.use('/v1/file', fileRouter);

export default app;
