import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';


const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import api from './api/index.js';
import { notFound, errorHandler } from './middlewares/errors.middleware.js';
import { apiLimiter } from './middlewares/rate-limit.middleware.js';

app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use((req, res, next) => {
	req.body ??= {};
	next();
});
app.use(cookieParser());
app.use(cors({
	origin: process.env.FRONTEND_URL || 'http://localhost:5173',
	credentials: true,
	optionsSuccessStatus: 200
}));

app.use((req, res, next) => {
	res.set('Cache-Control', 'no-store');
	next();
});

const frontendOrigin = new URL(process.env.FRONTEND_URL || 'http://localhost:5173').origin;
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

app.use((req, res, next) => {
	const origin = req.get('origin');
	if (SAFE_METHODS.includes(req.method) || !origin) return next();

	let originHost = null;
	try {
		originHost = new URL(origin).host;
	} catch (_) {}

	if (origin === frontendOrigin || originHost === req.get('host')) return next();

	res.status(403).json({
		success: false,
		message: 'Requests from other websites are not allowed'
	});
});

app.get('/', (req, res) => {
	res.status(200).json({
		message: 'API is located at /api/v1',
	});
});

app.get('/api/v1/up', (req, res) => {
	res.status(200).json({
		status: 'up',
		service: 'api',
	});
});

app.use('/api/v1', apiLimiter, api);
app.use(notFound);
app.use(errorHandler);

export default app;
