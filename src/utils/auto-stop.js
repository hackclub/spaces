import pg from "./db.js";
import { findSandbox } from "./sandboxes.js";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export const stopExpiredSpaces = async () => {
  const summary = { stopped: 0, reconciled: 0, failed: 0 };

  try {
    const threeHoursAgo = new Date(Date.now() - THREE_HOURS_MS);

    const runningSpaces = await pg('spaces')
      .where('running', true)
      .select(['id', 'container_id', 'user_id', 'type', 'started_at']);

    for (const space of runningSpaces) {
      try {
        const sandbox = await findSandbox(space.container_id);
        const expired = space.started_at && new Date(space.started_at) < threeHoursAgo;

        if (sandbox && sandbox.status === "running" && !expired) {
          continue;
        }

        if (sandbox && sandbox.status === "running") {
          await sandbox.stop();
          summary.stopped++;
          console.log(`[Auto-stop] Stopped space ${space.id} (sandbox ${space.container_id}) - runtime exceeded 3 hours`);
        } else {
          summary.reconciled++;
          console.log(`[Auto-stop] Space ${space.id} was already stopped, updated database status`);
        }

        await pg('spaces')
          .where('id', space.id)
          .update({ running: false });
      } catch (err) {
        summary.failed++;
        console.error(`[Auto-stop] Failed to stop space ${space.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Auto-stop] Error in stopExpiredSpaces:', err);
  }

  return summary;
};

export const startAutoStopJob = () => {
  const INTERVAL_MS = 5 * 60 * 1000;

  console.log('[Auto-stop] Starting auto-stop job - checking every 5 minutes for spaces running > 3 hours');

  stopExpiredSpaces();

  setInterval(() => {
    stopExpiredSpaces();
  }, INTERVAL_MS);
};
