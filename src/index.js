import app from './app.js';
import pg from './utils/db.js';
import { startAutoStopJob } from './utils/auto-stop.js';

const port = process.env.PORT || 5678;

async function main() {
	await pg.migrate.latest({
		directory: "./migrations"
	})

	app.listen(port, () => {
		console.log(`Server is up at port http://localhost:${port}`);
		startAutoStopJob();
	});
}

main()