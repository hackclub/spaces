import dotenv from 'dotenv';
import pg from '../src/utils/db.js';
import { recreateSpaceContainer } from '../src/utils/spaces.js';

dotenv.config();

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const getValue = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return fallback;
  return args[index + 1];
};

const dryRun = hasFlag('--dry-run');
const includeRunning = hasFlag('--include-running');
const limit = parseInt(getValue('--limit', '10'), 10);
const onlyId = getValue('--id', null);
const targetImage = process.env.CODE_SERVER_IMAGE;

const summarise = (label, rows) => {
  console.log(`\n${label}`);
  for (const row of rows) {
    console.log(`  space ${row.id}  user ${row.user_id}  type ${row.type}  running ${row.running}  image ${row.image}`);
  }
};

const main = async () => {
  if (!targetImage) {
    console.error('CODE_SERVER_IMAGE is not set. Refusing to run: every code-server space would be rebuilt onto the old image.');
    process.exit(1);
  }

  console.log(`Target image: ${targetImage}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}   limit: ${onlyId ? 'n/a (single id)' : limit}   running spaces: ${includeRunning ? 'INTERRUPTED' : 'skipped'}`);

  let query = pg('spaces')
    .where('type', 'code-server')
    .whereNot('image', targetImage)
    .orderBy([{ column: 'last_opened_at', order: 'desc', nulls: 'last' }, { column: 'id', order: 'desc' }]);

  if (onlyId) {
    query = pg('spaces').where('id', parseInt(onlyId, 10));
  } else {
    query = query.limit(limit);
  }

  const candidates = await query.select(
    'id', 'user_id', 'type', 'image', 'running', 'container_id',
    'volume_path', 'workspace_dir', 'password', 'last_opened_at'
  );

  if (candidates.length === 0) {
    console.log('\nNothing to migrate.');
    await pg.destroy();
    return;
  }

  summarise(`${candidates.length} space(s) selected:`, candidates);

  if (dryRun) {
    console.log('\nDry run only. Nothing changed.');
    await pg.destroy();
    return;
  }

  const running = candidates.filter((space) => space.running);
  const targets = includeRunning ? candidates : candidates.filter((s) => !s.running);

  if (running.length > 0) {
    if (includeRunning) {
      console.log(`\n${running.length} running space(s) will be interrupted and restarted on the new image.`);
    } else {
      console.log(`\nSkipping ${running.length} running space(s). Pass --include-running to migrate them too.`);
    }
  }

  const succeeded = [];
  const failed = [];

  for (const space of targets) {
    const wasRunning = Boolean(space.running);
    try {
      await recreateSpaceContainer(space, { start: wasRunning });
      succeeded.push(space.id);
      console.log(`  ok    space ${space.id}${wasRunning ? ' (restarted)' : ''}`);
    } catch (err) {
      failed.push({ id: space.id, error: err.message });
      console.error(`  FAIL  space ${space.id}: ${err.message}`);
    }
  }

  const skipped = includeRunning ? 0 : running.length;
  console.log(`\nMigrated: ${succeeded.length}   Failed: ${failed.length}   Skipped (running): ${skipped}`);
  if (failed.length > 0) {
    console.log('Failures:');
    for (const failure of failed) {
      console.log(`  space ${failure.id}: ${failure.error}`);
    }
  }

  await pg.destroy();
};

main().catch(async (err) => {
  console.error('Migration aborted:', err);
  await pg.destroy();
  process.exit(1);
});
