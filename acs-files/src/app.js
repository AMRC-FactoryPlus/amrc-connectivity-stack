import express from 'express';
import cors from 'cors';
import fileRouter from './routes/fileRoutes.js';

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Routes
app.use('/v1/file', fileRouter);

export default app;
