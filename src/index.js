import app from './app.js';
import pg from './utils/db.js';
import { startAutoStopJob } from './utils/auto-stop.js';
import { backfillWorkspaceDirs } from './utils/spaces.js';

const port = process.env.PORT || 5678;

async function main() {
	await pg.migrate.latest({
		directory: "./migrations"
	})

	app.listen(port, () => {
		console.log(`Server is up at port http://localhost:${port}`);
		startAutoStopJob();
		backfillWorkspaceDirs().catch((err) => console.error('Workspace dir backfill failed:', err));
	});
}

main()