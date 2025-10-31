import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';


const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import api from './api/index.js';
import { notFound, errorHandler } from './middlewares/errors.middleware.js';

if (process.env.NODE_ENV === 'production') {
	app.use(express.static('/client/public'));
	app.get('*', (req, res) => {
		res.sendFile(path.resolve(__dirname, 'client', 'public', 'index.html'));
	});
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
	res.status(200).json({
		message: 'API is located at /api/v1',
	});
});

app.use('/api/v1', api);
app.use(notFound);
app.use(errorHandler);

export default app;
