import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';


const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import api from './api/index.js';
import { notFound, errorHandler } from './middlewares/errors.middleware.js';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(cors({
	origin: process.env.FRONTEND_URL || 'http://localhost:5173',
	credentials: true,
	optionsSuccessStatus: 200
}));

app.get('/', (req, res) => {
	res.status(200).json({
		message: 'API is located at /api/v1',
	});
});

app.use('/api/v1', api);
app.use(notFound);
app.use(errorHandler);

export default app;
