import Docker from "dockerode";
import pg from "./db.js";

const docker = new Docker();

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export const stopExpiredSpaces = async () => {
  try {
    const threeHoursAgo = new Date(Date.now() - THREE_HOURS_MS);
    
    const expiredSpaces = await pg('spaces')
      .where('running', true)
      .where('started_at', '<', threeHoursAgo)
      .select(['id', 'container_id', 'user_id', 'type', 'started_at']);

    if (expiredSpaces.length === 0) {
      console.log('[Auto-stop] No expired spaces found');
      return;
    }

    console.log(`[Auto-stop] Found ${expiredSpaces.length} expired space(s) to stop`);

    for (const space of expiredSpaces) {
      try {
        const container = docker.getContainer(space.container_id);
        
        await container.inspect();
        await container.stop();
        
        await pg('spaces')
          .where('id', space.id)
          .update({ running: false });
        
        console.log(`[Auto-stop] Stopped space ${space.id} (container ${space.container_id}) - runtime exceeded 3 hours`);
      } catch (err) {
        if (err.statusCode === 304) {
          await pg('spaces')
            .where('id', space.id)
            .update({ running: false });
          console.log(`[Auto-stop] Space ${space.id} was already stopped, updated database status`);
        } else {
          console.error(`[Auto-stop] Failed to stop space ${space.id}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[Auto-stop] Error in stopExpiredSpaces:', err);
  }
};

export const startAutoStopJob = () => {
  const INTERVAL_MS = 5 * 60 * 1000;
  
  console.log('[Auto-stop] Starting auto-stop job - checking every 5 minutes for spaces running > 3 hours');
  
  stopExpiredSpaces();
  
  setInterval(() => {
    stopExpiredSpaces();
  }, INTERVAL_MS);
};
