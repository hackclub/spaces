import pg from './db.js';

export const recordRunStop = async (spaceId, reason, { timedOut = false } = {}) => {
  try {
    await pg('space_runs')
      .where('space_id', spaceId)
      .whereNull('stopped_at')
      .update({
        stopped_at: timedOut ? pg.raw("least(now(), started_at + interval '3 hours')") : new Date(),
        stop_reason: reason
      });
  } catch (err) {
    console.error(`Failed to record stop of space ${spaceId}:`, err);
  }
};

export const recordRunStart = async (space) => {
  await recordRunStop(space.id, 'restarted');
  try {
    await pg('space_runs').insert({
      space_id: space.id,
      user_id: space.user_id,
      type: space.type,
      started_at: new Date()
    });
  } catch (err) {
    console.error(`Failed to record start of space ${space.id}:`, err);
  }
};

export const getUsage = async (since) => {
  const end = pg.raw('coalesce(space_runs.stopped_at, now())');

  return pg('space_runs')
    .join('users', 'users.id', 'space_runs.user_id')
    .whereRaw('coalesce(space_runs.stopped_at, now()) > ?', [since])
    .groupBy('users.id')
    .select(
      'users.id',
      'users.username',
      'users.email',
      pg.raw('count(*)::int as runs'),
      pg.raw('(sum(extract(epoch from ? - greatest(space_runs.started_at, ?))) / 3600)::float as hours', [end, since]),
      pg.raw('(max(extract(epoch from ? - space_runs.started_at)) / 3600)::float as longest_hours', [end]),
      pg.raw('count(distinct date(space_runs.started_at))::int as active_days'),
      pg.raw('bool_or(space_runs.stopped_at is null) as running_now'),
      pg.raw('max(space_runs.started_at) as last_started')
    )
    .orderBy('hours', 'desc');
};
