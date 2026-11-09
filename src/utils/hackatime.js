import pg from './db.js';
import { hackatimeMachineFor } from './sandboxes.js';
import { spaceConfigs } from './spaces.js';

const HACKATIME_URL = process.env.HACKATIME_URL || 'https://hackatime.hackclub.com';
const PAGE_SIZE = 5000;
const GAP_SECONDS = 120;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HETZNER_IPV4 = '65.108.71.92';
const HETZNER_IPV6_PREFIX = '2a01:4f9:6b:4755:';
const HETZNER_SWITCH = new Date('2026-11-03T00:00:00Z');
const HETZNER_UNTIL = new Date('2026-11-09T00:00:00Z');
const SYNC_BUDGET_MS = 240000;
const IMPORT_BUDGET_MS = 150000;

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

const sanitizeKey = (key) => (key || '').replace(/[^a-zA-Z0-9\-_]/g, '');

export const resolveHackatimeUserId = async (user) => {
  if (user.hackatime_user_id) return user.hackatime_user_id;
  const key = sanitizeKey(user.hackatime_api_key);
  if (!key) return null;

  const response = await fetch(new URL('/api/hackatime/v1/users/current', HACKATIME_URL), {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Hackatime users/current answered ${response.status}`);

  const id = (await response.json())?.data?.id;
  if (!id) return null;
  await pg('users').where('id', user.id).update({ hackatime_user_id: String(id) });
  return String(id);
};

export const syncSpacesActivity = async ({ lookbackMs = 3 * HOUR_MS, budgetMs = SYNC_BUDGET_MS } = {}) => {
  if (!hackatimeConfigured()) return { skipped: 'HACKATIME_ADMIN_KEY is not set' };

  const deadline = Date.now() + budgetMs;
  const fromHour = Math.floor((Date.now() - lookbackMs) / HOUR_MS) * HOUR_MS;
  const recentIds = await pg('space_runs')
    .whereNotNull('space_id')
    .where((query) => query.whereNull('stopped_at').orWhere('stopped_at', '>=', new Date(fromHour)))
    .distinct('space_id')
    .pluck('space_id');
  const spaces = recentIds.length
    ? await pg('spaces')
      .join('users', 'users.id', 'spaces.user_id')
      .whereIn('spaces.id', recentIds)
      .select('spaces.id', 'spaces.user_id', 'users.hackatime_api_key', 'users.hackatime_user_id')
    : [];

  const summary = { spaces: spaces.length, hours: 0, failed: 0, noKey: 0, unfinished: 0 };
  for (const space of spaces) {
    if (Date.now() > deadline) {
      summary.unfinished += 1;
      continue;
    }
    try {
      const hackatimeUserId = await resolveHackatimeUserId({ id: space.user_id, hackatime_api_key: space.hackatime_api_key, hackatime_user_id: space.hackatime_user_id });
      if (!hackatimeUserId) {
        summary.noKey += 1;
        continue;
      }
      const machine = hackatimeMachineFor(space.id);
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
  const rows = await pg('hackatime_imports').select('status').count('* as n').groupBy('status');
  const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
  const lastError = await pg('hackatime_imports').where('status', 'failed').orderBy('updated_at', 'desc').first('error');
  return {
    pending: counts.pending ?? 0,
    done: counts.done ?? 0,
    failed: counts.failed ?? 0,
    noKey: counts.no_key ?? 0,
    lastError: lastError?.error ?? null,
    started: rows.length > 0
  };
};

export const startHetznerImport = async () => {
  const userIds = await pg('spaces').where('created_at', '<', HETZNER_SWITCH).distinct('user_id').pluck('user_id');
  if (userIds.length) {
    await pg('hackatime_imports').insert(userIds.map((userId) => ({ user_id: userId }))).onConflict('user_id').ignore();
  }
  return userIds.length;
};

export const continueHetznerImport = async ({ budgetMs = IMPORT_BUDGET_MS } = {}) => {
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const job = await pg('hackatime_imports').where('status', 'pending').orderBy('updated_at').first();
    if (!job) break;

    const finish = (status, error = null) => pg('hackatime_imports')
      .where('user_id', job.user_id)
      .update({ status, error: error ? error.slice(0, 500) : null, updated_at: pg.fn.now() });

    try {
      const user = await pg('users').where('id', job.user_id).first('id', 'hackatime_api_key', 'hackatime_user_id');
      const hackatimeUserId = user ? await resolveHackatimeUserId(user) : null;
      if (!hackatimeUserId) {
        await finish('no_key');
        continue;
      }

      const { first } = await pg('spaces').where('user_id', job.user_id).min('created_at as first').first();
      const start = first ? new Date(first).getTime() - DAY_MS : undefined;
      const heartbeats = (await fetchHeartbeats({ hackatimeUserId, start, end: HETZNER_UNTIL.getTime() }))
        .filter((heartbeat) => isHetznerIp(heartbeat.ip_address));

      const byMachine = new Map();
      for (const heartbeat of heartbeats) {
        const machine = heartbeat.machine ?? '';
        if (!byMachine.has(machine)) byMachine.set(machine, []);
        byMachine.get(machine).push(heartbeat.time);
      }
      for (const [machine, times] of byMachine) {
        await saveBuckets({ source: 'hetzner', machine, hackatimeUserId, userId: job.user_id, buckets: bucketize(times) });
      }

      await finish('done');
    } catch (err) {
      console.error(`Failed to import old server Hackatime time for user ${job.user_id}:`, err.message);
      await finish('failed', err.message);
    }
  }

  return hetznerImportProgress();
};

export const retryFailedHetznerImports = () => pg('hackatime_imports')
  .where('status', 'failed')
  .update({ status: 'pending', error: null, updated_at: pg.fn.now() });

const UNKNOWN_TYPE = 'unknown';

const ACTIVITY_SQL = `
  with activity as (
    select a.*,
      coalesce(a.space_id, m.space_id) as effective_space_id,
      coalesce(a.user_id, m.user_id, s.user_id) as effective_user_id,
      coalesce(s.type, '${UNKNOWN_TYPE}') as space_type
    from hackatime_activity a
    left join hackatime_legacy_machines m on m.machine = a.machine
    left join spaces s on s.id = coalesce(a.space_id, m.space_id)
    where a.hour >= ? and (?::text is null or coalesce(s.type, '${UNKNOWN_TYPE}') = ?) and not coalesce(s.hackatime_excluded, false)
  )
`;

const typeLabel = (type) => (type === UNKNOWN_TYPE ? 'Deleted or unmatched spaces' : spaceConfigs[type]?.title ?? type);

const tracksHackatime = (config) => config.kind === 'editor' || Boolean(config.hackatime);

export const hackatimeReportTypes = () => [...Object.keys(spaceConfigs), UNKNOWN_TYPE];

const summarizeTypes = async (since) => {
  const [activity, combined, spaceCounts] = await Promise.all([
    pg.raw(`${ACTIVITY_SQL}
      select space_type, source, sum(seconds)::bigint as seconds, min(first_at) as first_at, max(last_at) as last_at
      from activity group by 1, 2`, [since, null, null]),
    pg.raw(`${ACTIVITY_SQL}
      select space_type,
        count(distinct coalesce(effective_user_id::text, 'h' || hackatime_user_id::text)) as people,
        count(distinct coalesce(effective_space_id::text, machine)) as spaces,
        count(distinct date_trunc('day', hour)) as active_days
      from activity group by 1`, [since, null, null]),
    pg('spaces').where({ creating: false, hackatime_excluded: false }).select('type').count('* as count').groupBy('type')
  ]);

  const byType = new Map();
  const entry = (type) => {
    if (!byType.has(type)) {
      const config = spaceConfigs[type];
      byType.set(type, {
        type,
        label: typeLabel(type),
        tracksHackatime: config ? tracksHackatime(config) : null,
        seconds: 0,
        bySource: {},
        people: 0,
        spaces: 0,
        activeDays: 0,
        totalSpaces: 0,
        firstAt: null,
        lastAt: null
      });
    }
    return byType.get(type);
  };

  for (const type of Object.keys(spaceConfigs)) entry(type);
  for (const row of activity.rows) {
    const item = entry(row.space_type);
    const seconds = Number(row.seconds);
    item.seconds += seconds;
    item.bySource[row.source] = (item.bySource[row.source] ?? 0) + seconds;
    if (!item.firstAt || row.first_at < item.firstAt) item.firstAt = row.first_at;
    if (!item.lastAt || row.last_at > item.lastAt) item.lastAt = row.last_at;
  }
  for (const row of combined.rows) {
    const item = entry(row.space_type);
    item.people = Number(row.people);
    item.spaces = Number(row.spaces);
    item.activeDays = Number(row.active_days);
  }
  for (const row of spaceCounts) {
    if (byType.has(row.type)) byType.get(row.type).totalSpaces = Number(row.count);
  }

  const total = [...byType.values()].reduce((sum, item) => sum + item.seconds, 0);
  return [...byType.values()]
    .filter((item) => item.type !== UNKNOWN_TYPE || item.seconds > 0)
    .map((item) => ({ ...item, share: total ? item.seconds / total : 0 }))
    .sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
};

export const getHackatimeReport = async ({ days = 30, type = null } = {}) => {
  const since = days ? new Date(Math.floor((Date.now() - days * DAY_MS) / DAY_MS) * DAY_MS) : new Date(0);
  const params = [since, type, type];

  const [totals, daily, users, spaces, tracked, progress, byType, excluded] = await Promise.all([
    pg.raw(`${ACTIVITY_SQL}
      select source, sum(seconds)::bigint as seconds, min(first_at) as first_at, max(last_at) as last_at
      from activity group by source`, params),
    pg.raw(`${ACTIVITY_SQL}
      select to_char(date_trunc('day', hour), 'YYYY-MM-DD') as day, sum(seconds)::bigint as seconds
      from activity group by 1 order by 1`, params),
    pg.raw(`${ACTIVITY_SQL}
      select activity.effective_user_id as user_id, activity.hackatime_user_id, u.username, u.email,
        sum(seconds)::bigint as seconds, min(first_at) as first_at, max(last_at) as last_at
      from activity left join users u on u.id = activity.effective_user_id
      group by 1, 2, 3, 4 order by seconds desc`, params),
    pg.raw(`${ACTIVITY_SQL}
      select activity.effective_space_id as space_id, activity.effective_user_id as user_id, activity.hackatime_user_id,
        activity.machine, activity.source, s.name, activity.space_type as type,
        sum(seconds)::bigint as seconds, min(first_at) as first_at, max(last_at) as last_at
      from activity left join spaces s on s.id = activity.effective_space_id
      group by 1, 2, 3, 4, 5, 6, 7 order by seconds desc`, params),
    pg('hackatime_activity').where('source', 'spaces').min('hour as since').first(),
    hetznerImportProgress(),
    summarizeTypes(since),
    pg('spaces').where('hackatime_excluded', true).count('* as count').first()
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
      typeLabel: typeLabel(row.type),
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
    type,
    typeLabel: type ? typeLabel(type) : null,
    byType,
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
    hetznerImport: progress,
    excludedSpaces: Number(excluded?.count ?? 0)
  };
};
