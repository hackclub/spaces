import pg from './db.js';

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let lastCleanup = 0;

const cleanupExpired = () => {
  if (Date.now() - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = Date.now();

  pg('rate_limits')
    .where('reset_at', '<', pg.fn.now())
    .delete()
    .catch((error) => {
      console.error('Failed to clean up expired rate limits:', error);
    });
};

export const postgresStore = (prefix) => {
  let windowMs = 60 * 1000;

  return {
    prefix,
    localKeys: false,

    init(options) {
      windowMs = options.windowMs;
    },

    async get(key) {
      const row = await pg('rate_limits')
        .where('key', prefix + key)
        .where('reset_at', '>', pg.fn.now())
        .first();

      if (!row) return undefined;

      return { totalHits: row.hits, resetTime: new Date(row.reset_at) };
    },

    async increment(key) {
      cleanupExpired();

      const { rows } = await pg.raw(`
        insert into rate_limits (key, hits, reset_at)
        values (?, 1, now() + ?::double precision * interval '1 millisecond')
        on conflict (key) do update set
          hits = case when rate_limits.reset_at <= now() then 1 else rate_limits.hits + 1 end,
          reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at else rate_limits.reset_at end
        returning hits, reset_at
      `, [prefix + key, windowMs]);

      return { totalHits: rows[0].hits, resetTime: new Date(rows[0].reset_at) };
    },

    async decrement(key) {
      await pg('rate_limits')
        .where('key', prefix + key)
        .where('reset_at', '>', pg.fn.now())
        .where('hits', '>', 0)
        .decrement('hits', 1);
    },

    async resetKey(key) {
      await pg('rate_limits').where('key', prefix + key).delete();
    }
  };
};
