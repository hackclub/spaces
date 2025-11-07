import app from './app.js';
import { startAutoStopJob } from './utils/auto-stop.js';

const port = process.env.PORT || 5678;

app.listen(port, () => {
	console.log(`Server is up at port http://localhost:${port}`);
	startAutoStopJob();
});

