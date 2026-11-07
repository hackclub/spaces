import pg from './db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const utcDay = (date) => date.toISOString().slice(0, 10);

const dayOf = (column) => pg.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD') as day`);

const migrationTime = async (name) => {
  const row = await pg('knex_migrations').where('name', name).first('migration_time');
  return row ? new Date(row.migration_time) : null;
};

const byDay = (rows) => Object.fromEntries(rows.map((row) => [row.day, row]));

const countOf = async (query) => Number((await query.count('* as n').first()).n);

export const getStats = async (days) => {
  const today = new Date(`${utcDay(new Date())}T00:00:00Z`);
  const start = new Date(today.getTime() - (days - 1) * DAY_MS);
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);

  const [usersSince, runsSince] = await Promise.all([
    migrationTime('20261107_add_signup_dates_and_logins.js'),
    migrationTime('20261102_add_space_runs.js')
  ]);

  const [
    totalUsers,
    totalSpaces,
    usersBefore,
    spacesBefore,
    loggedInWeek,
    activeWeek,
    newUsers,
    logins,
    newSpaces,
    spaceTypes,
    runs
  ] = await Promise.all([
    countOf(pg('users')),
    countOf(pg('spaces')),
    countOf(pg('users').where((q) => q.whereNull('created_at').orWhere('created_at', '<', start))),
    countOf(pg('spaces').where((q) => q.whereNull('created_at').orWhere('created_at', '<', start))),
    pg('logins').where('created_at', '>', weekAgo).countDistinct('user_id as n').first(),
    pg('space_runs').whereRaw('coalesce(stopped_at, now()) > ?', [weekAgo]).countDistinct('user_id as n').first(),
    pg('users').where('created_at', '>=', start).select(dayOf('created_at')).count('* as n').groupBy('day'),
    pg('logins').where('created_at', '>=', start).select(dayOf('created_at'))
      .countDistinct('user_id as people').count('* as logins').groupBy('day'),
    pg('spaces').where('created_at', '>=', start).select(dayOf('created_at')).count('* as n').groupBy('day'),
    pg('spaces').where('created_at', '>=', start).select('type').count('* as n').groupBy('type').orderBy('n', 'desc'),
    pg.raw(`
      select to_char(d.day at time zone 'UTC', 'YYYY-MM-DD') as day,
        count(distinct r.user_id)::int as people,
        (count(r.id) filter (where r.started_at >= d.day))::int as starts,
        coalesce(sum(extract(epoch from least(coalesce(r.stopped_at, now()), d.day + interval '1 day') - greatest(r.started_at, d.day))), 0)::float / 3600 as hours
      from generate_series(?::timestamptz, now(), interval '1 day') as d(day)
      left join space_runs r on r.started_at < d.day + interval '1 day' and coalesce(r.stopped_at, now()) > d.day
      group by d.day
    `, [start])
  ]);

  const usersSinceDay = usersSince ? utcDay(usersSince) : null;
  const runsSinceDay = runsSince ? utcDay(runsSince) : null;
  const newUsersByDay = byDay(newUsers);
  const loginsByDay = byDay(logins);
  const newSpacesByDay = byDay(newSpaces);
  const runsByDay = byDay(runs.rows);

  let usersSoFar = usersBefore;
  let spacesSoFar = spacesBefore;
  const daily = [];

  for (let time = start.getTime(); time <= today.getTime(); time += DAY_MS) {
    const day = utcDay(new Date(time));
    const usersRecorded = usersSinceDay !== null && day >= usersSinceDay;
    const runsRecorded = runsSinceDay !== null && day >= runsSinceDay;
    const joined = Number(newUsersByDay[day]?.n ?? 0);
    const created = Number(newSpacesByDay[day]?.n ?? 0);
    const run = runsByDay[day];

    usersSoFar += joined;
    spacesSoFar += created;

    daily.push({
      day,
      newUsers: usersRecorded ? joined : null,
      totalUsers: usersRecorded ? usersSoFar : null,
      loggedIn: usersRecorded ? Number(loginsByDay[day]?.people ?? 0) : null,
      logins: usersRecorded ? Number(loginsByDay[day]?.logins ?? 0) : null,
      activePeople: runsRecorded ? run?.people ?? 0 : null,
      starts: runsRecorded ? run?.starts ?? 0 : null,
      hours: runsRecorded ? run?.hours ?? 0 : null,
      newSpaces: created,
      totalSpaces: spacesSoFar
    });
  }

  return {
    days,
    recordedSince: {
      users: usersSince,
      runs: runsSince
    },
    totals: {
      users: totalUsers,
      spaces: totalSpaces,
      loggedInWeek: usersSince ? Number(loggedInWeek.n) : null,
      activeWeek: runsSince ? Number(activeWeek.n) : null
    },
    spaceTypes: spaceTypes.map(({ type, n }) => ({ type, count: Number(n) })),
    daily
  };
};
