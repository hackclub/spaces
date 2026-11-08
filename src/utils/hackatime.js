import pg from './db.js';
import { hackatimeMachineFor } from './sandboxes.js';

const HACKATIME_URL = process.env.HACKATIME_URL || 'https://hackatime.hackclub.com';
const PAGE_SIZE = 5000;
const GAP_SECONDS = 120;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HETZNER_IPV4 = '65.108.71.92';
const HETZNER_IPV6_PREFIX = '2a01:4f9:6b:4755:';
const HETZNER_LOOKUP_IPS = [HETZNER_IPV4, '2a01:4f9:6b:4755::2'];
const HETZNER_UNTIL = new Date('2026-11-09T00:00:00Z');
const LOOKUP_PREFIX = 'ip:';
const LOOKUP_TIMEOUT_MS = 270000;

export const hackatimeConfigured = () => Boolean(process.env.HACKATIME_ADMIN_KEY);

const adminGet = async (path, params = {}, { timeoutMs = 60000 } = {}) => {
  const url = new URL(`/api/admin/v1/${path}`, HACKATIME_URL);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.HACKATIME_ADMIN_KEY}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Hackatime ${path} answered ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  return response.json();
};

const toSeconds = (time) => (time > 1e12 ? time / 1000 : time);

const fetchHeartbeats = async ({ hackatimeUserId, machine, start, end }) => {
  const heartbeats = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const data = await adminGet('user/heartbeats', {
      user_id: hackatimeUserId,
      machine,
      start_date: start ? Math.floor(start / 1000) : undefined,
      end_date: end ? Math.floor(end / 1000) : undefined,
      limit: PAGE_SIZE,
      offset
    });
    const page = data.heartbeats ?? [];
    heartbeats.push(...page.filter((heartbeat) => !heartbeat.hidden));
    if (!data.has_more || page.length === 0) break;
  }
  return heartbeats;
};

export const bucketize = (times) => {
  const sorted = times.map(toSeconds).filter(Number.isFinite).sort((a, b) => a - b);
  const buckets = new Map();

  sorted.forEach((time, index) => {
    const hour = Math.floor((time * 1000) / HOUR_MS) * HOUR_MS;
    const bucket = buckets.get(hour) ?? { seconds: 0, heartbeats: 0, first: time, last: time };
    bucket.heartbeats += 1;
    bucket.first = Math.min(bucket.first, time);
    bucket.last = Math.max(bucket.last, time);
    const next = sorted[index + 1];
    if (next !== undefined && next - time <= GAP_SECONDS) {
      bucket.seconds += next - time;
    }
    buckets.set(hour, bucket);
  });

  return buckets;
};

const saveBuckets = async ({ source, machine, hackatimeUserId, spaceId = null, userId = null, buckets, fromHour = 0 }) => {
  const rows = [...buckets.entries()]
    .filter(([hour]) => hour >= fromHour)
    .map(([hour, bucket]) => ({
      source,
      machine,
      hackatime_user_id: String(hackatimeUserId),
      space_id: spaceId,
      user_id: userId,
      hour: new Date(hour),
      seconds: Math.round(bucket.seconds),
      heartbeats: bucket.heartbeats,
      first_at: new Date(bucket.first * 1000),
      last_at: new Date(bucket.last * 1000)
    }));

  if (rows.length === 0) return 0;

  await pg('hackatime_activity')
    .insert(rows)
    .onConflict(['machine', 'hackatime_user_id', 'hour'])
    .merge(['source', 'space_id', 'user_id', 'seconds', 'heartbeats', 'first_at', 'last_at']);

  return rows.length;
};

export const syncSpacesActivity = async ({ lookbackMs = 3 * HOUR_MS } = {}) => {
  if (!hackatimeConfigured()) return { skipped: 'HACKATIME_ADMIN_KEY is not set' };

  const fromHour = Math.floor((Date.now() - lookbackMs) / HOUR_MS) * HOUR_MS;
  const recentIds = await pg('space_runs')
    .whereNotNull('space_id')
    .where((query) => query.whereNull('stopped_at').orWhere('stopped_at', '>=', new Date(fromHour)))
    .distinct('space_id')
    .pluck('space_id');
  const spaces = recentIds.length ? await pg('spaces').whereIn('id', recentIds).select('id', 'user_id') : [];

  const summary = { spaces: spaces.length, hours: 0, failed: 0 };
  for (const space of spaces) {
    const machine = hackatimeMachineFor(space.id);
    try {
      const { users = [] } = await adminGet('user/get_users_by_machine', { machine });
      for (const hackatimeUserId of new Set(users.map((user) => String(user.user_id)))) {
        const heartbeats = await fetchHeartbeats({ hackatimeUserId, machine, start: fromHour - GAP_SECONDS * 1000, end: Date.now() });
        summary.hours += await saveBuckets({
          source: 'spaces',
          machine,
          hackatimeUserId,
          spaceId: space.id,
          userId: space.user_id,
          buckets: bucketize(heartbeats.map((heartbeat) => heartbeat.time)),
          fromHour
        });
      }
    } catch (err) {
      summary.failed += 1;
      console.error(`Failed to sync Hackatime time for space ${space.id}:`, err.message);
    }
  }
  return summary;
};

const isHetznerIp = (ip) => {
  const value = String(ip ?? '').toLowerCase();
  return value === HETZNER_IPV4 || value.startsWith(HETZNER_IPV6_PREFIX);
};

export const hetznerImportProgress = async () => {
  const rows = await pg('hackatime_imports')
    .select('status', pg.raw("hackatime_user_id = '' as lookup"))
    .count('* as n')
    .groupBy('status', 'lookup');
  const count = (status, lookup) => rows
    .filter((row) => row.status === status && Boolean(row.lookup) === lookup)
    .reduce((sum, row) => sum + Number(row.n), 0);
  const lastLookupError = await pg('hackatime_imports')
    .where({ hackatime_user_id: '', status: 'failed' })
    .orderBy('updated_at', 'desc')
    .first('machine', 'error', 'updated_at');
  return {
    lookupError: lastLookupError ? `${lastLookupError.machine.slice(LOOKUP_PREFIX.length)}: ${lastLookupError.error}` : null,
    lookingUp: count('pending', true),
    lookupFailed: count('failed', true),
    pending: count('pending', false),
    done: count('done', false),
    failed: count('failed', false),
    started: rows.length > 0
  };
};

export const startHetznerImport = async () => {
  await pg('hackatime_imports')
    .insert(HETZNER_LOOKUP_IPS.map((ip) => ({ hackatime_user_id: '', machine: `${LOOKUP_PREFIX}${ip}` })))
    .onConflict(['hackatime_user_id', 'machine'])
    .ignore();
};

const lookUpIp = async (ip) => {
  const { users = [] } = await adminGet('user/get_users_by_ip', { ip }, { timeoutMs: LOOKUP_TIMEOUT_MS });
  const pairs = new Map();
  for (const user of users) {
    const pair = { hackatime_user_id: String(user.user_id), machine: user.machine ?? '' };
    pairs.set(`${pair.hackatime_user_id}|${pair.machine}`, pair);
  }
  if (pairs.size) {
    await pg('hackatime_imports').insert([...pairs.values()]).onConflict(['hackatime_user_id', 'machine']).ignore();
  }
  return pairs.size;
};

export const continueHetznerImport = async ({ budgetMs = 150000 } = {}) => {
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const job = await pg('hackatime_imports')
      .where('status', 'pending')
      .orderByRaw("hackatime_user_id = '' desc")
      .orderBy('updated_at')
      .first();
    if (!job) break;

    if (job.hackatime_user_id === '') {
      try {
        await lookUpIp(job.machine.slice(LOOKUP_PREFIX.length));
        await pg('hackatime_imports').where({ hackatime_user_id: '', machine: job.machine }).update({ status: 'done', error: null, updated_at: pg.fn.now() });
      } catch (err) {
        console.error(`Hackatime lookup for ${job.machine} failed:`, err.message);
        await pg('hackatime_imports').where({ hackatime_user_id: '', machine: job.machine }).update({ status: 'failed', error: err.message.slice(0, 500), updated_at: pg.fn.now() });
      }
      break;
    }

    try {
      const heartbeats = (await fetchHeartbeats({
        hackatimeUserId: job.hackatime_user_id,
        machine: job.machine || undefined,
        end: HETZNER_UNTIL.getTime()
      })).filter((heartbeat) => isHetznerIp(heartbeat.ip_address));

      const byMachine = new Map();
      for (const heartbeat of heartbeats) {
        const machine = heartbeat.machine ?? '';
        if (!byMachine.has(machine)) byMachine.set(machine, []);
        byMachine.get(machine).push(heartbeat.time);
      }
      for (const [machine, times] of byMachine) {
        await saveBuckets({ source: 'hetzner', machine, hackatimeUserId: job.hackatime_user_id, buckets: bucketize(times) });
      }

      await pg('hackatime_imports')
        .where({ hackatime_user_id: job.hackatime_user_id, machine: job.machine })
        .update({ status: 'done', error: null, updated_at: pg.fn.now() });
    } catch (err) {
      await pg('hackatime_imports')
        .where({ hackatime_user_id: job.hackatime_user_id, machine: job.machine })
        .update({ status: 'failed', error: err.message.slice(0, 500), updated_at: pg.fn.now() });
    }
  }

  return hetznerImportProgress();
};

export const retryFailedHetznerImports = () => pg('hackatime_imports')
  .where('status', 'failed')
  .update({ status: 'pending', error: null, updated_at: pg.fn.now() });

const ACTIVITY_SQL = `
  with activity as (
    select a.*,
      coalesce(a.space_id, m.space_id) as effective_space_id,
      coalesce(a.user_id, m.user_id, s.user_id) as effective_user_id
    from hackatime_activity a
    left join hackatime_legacy_machines m on m.machine = a.machine
    left join spaces s on s.id = coalesce(a.space_id, m.space_id)
    where a.hour >= ?
  )
`;

export const getHackatimeReport = async ({ days = 30 } = {}) => {
  const since = days ? new Date(Math.floor((Date.now() - days * DAY_MS) / DAY_MS) * DAY_MS) : new Date(0);

  const [totals, daily, users, spaces, tracked, progress] = await Promise.all([
    pg.raw(`${ACTIVITY_SQL}
      select source, sum(seconds)::bigint as seconds, min(first_at) as first_at, max(last_at) as last_at
      from activity group by source`, [since]),
    pg.raw(`${ACTIVITY_SQL}
      select to_char(date_trunc('day', hour), 'YYYY-MM-DD') as day, sum(seconds)::bigint as seconds
      from activity group by 1 order by 1`, [since]),
    pg.raw(`${ACTIVITY_SQL}
      select activity.effective_user_id as user_id, activity.hackatime_user_id, u.username, u.email,
        sum(seconds)::bigint as seconds, min(first_at) as first_at, max(last_at) as last_at
      from activity left join users u on u.id = activity.effective_user_id
      group by 1, 2, 3, 4 order by seconds desc`, [since]),
    pg.raw(`${ACTIVITY_SQL}
      select activity.effective_space_id as space_id, activity.effective_user_id as user_id, activity.hackatime_user_id,
        activity.machine, activity.source, s.name, s.type,
        sum(seconds)::bigint as seconds, min(first_at) as first_at, max(last_at) as last_at
      from activity left join spaces s on s.id = activity.effective_space_id
      group by 1, 2, 3, 4, 5, 6, 7 order by seconds desc`, [since]),
    pg('hackatime_activity').where('source', 'spaces').min('hour as since').first(),
    hetznerImportProgress()
  ]);

  const dailyByDay = new Map(daily.rows.map((row) => [row.day, Number(row.seconds)]));
  const firstDay = daily.rows[0]?.day;
  const start = days ? since : (firstDay ? new Date(`${firstDay}T00:00:00Z`) : new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS));
  const series = [];
  for (let day = start.getTime(); day <= Date.now(); day += DAY_MS) {
    const key = new Date(day).toISOString().slice(0, 10);
    series.push({ day: key, hours: Math.round(((dailyByDay.get(key) ?? 0) / 3600) * 10) / 10 });
  }

  const spacesByUser = new Map();
  for (const row of spaces.rows) {
    const key = `${row.user_id ?? ''}|${row.hackatime_user_id}`;
    if (!spacesByUser.has(key)) spacesByUser.set(key, []);
    spacesByUser.get(key).push({
      spaceId: row.space_id,
      name: row.name,
      type: row.type,
      machine: row.machine,
      source: row.source,
      seconds: Number(row.seconds),
      firstAt: row.first_at,
      lastAt: row.last_at
    });
  }

  const bySource = Object.fromEntries(totals.rows.map((row) => [row.source, Number(row.seconds)]));

  return {
    configured: hackatimeConfigured(),
    days,
    since,
    trackingSince: tracked?.since ?? null,
    totalSeconds: Object.values(bySource).reduce((sum, seconds) => sum + seconds, 0),
    bySource,
    firstAt: totals.rows.reduce((first, row) => (!first || row.first_at < first ? row.first_at : first), null),
    lastAt: totals.rows.reduce((last, row) => (!last || row.last_at > last ? row.last_at : last), null),
    daily: series,
    users: users.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      email: row.email,
      hackatimeUserId: row.hackatime_user_id,
      seconds: Number(row.seconds),
      firstAt: row.first_at,
      lastAt: row.last_at,
      spaces: spacesByUser.get(`${row.user_id ?? ''}|${row.hackatime_user_id}`) ?? []
    })),
    hetznerImport: progress
  };
};
