<script>
  import { API_BASE } from '../config.js';
  import StatChart from './StatChart.svelte';

  export let canImport = false;

  const PERIODS = [
    { value: 7, label: 'Last 7 days' },
    { value: 30, label: 'Last 30 days' },
    { value: 90, label: 'Last 90 days' },
    { value: null, label: 'All time' }
  ];

  let days = 30;
  let type = '';
  let report = null;
  let loading = true;
  let error = '';
  let expanded = new Set();
  let importing = false;
  let importMessage = '';

  const hours = (seconds) => `${(seconds / 3600).toFixed(1)} h`;
  const when = (value) => (value ? new Date(value).toLocaleString() : '—');
  const day = (value) => (value ? new Date(value).toLocaleDateString() : '—');
  const percent = (share) => `${(share * 100).toFixed(share > 0 && share < 0.01 ? 1 : 0)}%`;

  async function load() {
    loading = true;
    error = '';
    try {
      const response = await fetch(`${API_BASE}/admin/hackatime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ days, type: type || null })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to load Hackatime time');
      report = data.data;
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function toggle(key) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    expanded = expanded;
  }

  function describeImport(progress) {
    const parts = [`${progress.done} people done`, `${progress.pending} left`];
    if (progress.noKey) parts.push(`${progress.noKey} without a Hackatime key`);
    if (progress.failed) parts.push(`${progress.failed} failed (${progress.lastError ?? 'unknown error'})`);
    return parts.join(', ');
  }

  async function runImport(retryFailed = false) {
    importing = true;
    importMessage = '';
    try {
      let progress;
      do {
        const response = await fetch(`${API_BASE}/admin/hackatime/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ retryFailed })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Import failed');
        progress = data.data.progress;
        retryFailed = false;
        importMessage = describeImport(progress);
      } while (progress.pending > 0);
      await load();
    } catch (err) {
      importMessage = err.message;
    } finally {
      importing = false;
    }
  }

  function pickType(value) {
    type = type === value ? '' : value;
  }

  $: days, type, load();
  $: typeOptions = (report?.byType ?? []).map((item) => ({ value: item.type, label: item.label }));
  $: maxTypeSeconds = Math.max(1, ...(report?.byType ?? []).map((item) => item.seconds));

</script>

<section class="hackatime">
  <div class="head">
    <h2>Hackatime{report?.typeLabel ? `: ${report.typeLabel}` : ''}</h2>
    <div class="filters">
      <select bind:value={type} class="period" aria-label="Space type">
        <option value="">All space types</option>
        {#each typeOptions as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
      <select bind:value={days} class="period" aria-label="Period">
        {#each PERIODS as period}
          <option value={period.value}>{period.label}</option>
        {/each}
      </select>
    </div>
  </div>

  {#if loading && !report}
    <p class="note">Loading Hackatime time...</p>
  {:else if error}
    <p class="note error">{error}</p>
  {:else if report}
    {#if !report.configured}
      <p class="note warn">Hackatime isn't connected yet. Add an admin key with only the <code>heartbeats:read</code> scope as <code>HACKATIME_ADMIN_KEY</code> in Vercel.</p>
    {/if}

    <div class="cards">
      <div class="card">
        <h3>Total</h3>
        <p class="big">{hours(report.totalSeconds)}</p>
        <p class="sub">{report.users.length} {report.users.length === 1 ? 'person' : 'people'}</p>
      </div>
      <div class="card">
        <h3>Vercel spaces</h3>
        <p class="big">{hours(report.bySource.spaces ?? 0)}</p>
        <p class="sub">{report.trackingSince ? `tracked since ${day(report.trackingSince)}` : 'nothing tracked yet'}</p>
      </div>
      <div class="card">
        <h3>Old server</h3>
        <p class="big">{hours(report.bySource.hetzner ?? 0)}</p>
        <p class="sub">before November 2026</p>
      </div>
      <div class="card">
        <h3>Activity</h3>
        <p class="range">{when(report.firstAt)}</p>
        <p class="sub">to {when(report.lastAt)}</p>
      </div>
    </div>

    <p class="note">Time from Nov 1, 2026 until spaces started tagging their Hackatime heartbeats can't be told apart from other machines, so it isn't counted.</p>

    <h3 class="section">By space type</h3>
    <div class="table-wrap">
      <table class="types">
        <thead>
          <tr>
            <th>Type</th>
            <th>Hours</th>
            <th>Share</th>
            <th>People</th>
            <th>Spaces with time</th>
            <th>Per person</th>
            <th>Active days</th>
            <th>Vercel</th>
            <th>Old server</th>
            <th>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {#each report.byType as item (item.type)}
            <tr class="type-row" class:selected={type === item.type} on:click={() => pickType(item.type)}>
              <td>
                <strong>{item.label}</strong>
                {#if item.tracksHackatime === false}<span class="tag">doesn't track</span>{/if}
              </td>
              <td>
                {hours(item.seconds)}
                <span class="bar" aria-hidden="true"><span style="width: {(item.seconds / maxTypeSeconds) * 100}%"></span></span>
              </td>
              <td>{percent(item.share)}</td>
              <td>{item.people}</td>
              <td>{item.type === 'unknown' ? item.spaces : `${item.spaces} of ${item.totalSpaces}`}</td>
              <td>{item.people ? hours(item.seconds / item.people) : '—'}</td>
              <td>{item.activeDays}</td>
              <td>{item.bySource.spaces ? hours(item.bySource.spaces) : '—'}</td>
              <td>{item.bySource.hetzner ? hours(item.bySource.hetzner) : '—'}</td>
              <td>{when(item.lastAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="note">Click a type to see only its time below. Types marked "doesn't track" have no Hackatime plugin, so they never show time.</p>

    {#if report.daily.length > 1}
      <StatChart title={`Hackatime hours per day${report.typeLabel ? ` in ${report.typeLabel}` : ''}`} rows={report.daily} key="hours" format={(value) => `${value} h`} />
    {/if}

    {#if canImport && !type}
      <div class="import">
        <button class="btn" on:click={() => runImport(false)} disabled={importing || !report.configured}>
          {importing ? 'Importing...' : report.hetznerImport.started ? 'Continue old server import' : 'Import old server time'}
        </button>
        {#if report.hetznerImport.failed && !importing}
          <button class="btn" on:click={() => runImport(true)}>Retry failed</button>
        {/if}
        <span class="note">
          {importMessage || (report.hetznerImport.started
            ? describeImport(report.hetznerImport)
            : "Goes through everyone who had a space on the old server and adds the time their Hackatime heartbeats came from it. People without a Hackatime key in Settings can't be included.")}
        </span>
      </div>
    {/if}

    {#if report.users.length}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Hours</th>
              <th>Spaces</th>
              <th>First</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody>
            {#each report.users as person (`${person.userId}|${person.hackatimeUserId}`)}
              {@const key = `${person.userId}|${person.hackatimeUserId}`}
              <tr class="person" on:click={() => toggle(key)}>
                <td>
                  <button class="expand" aria-expanded={expanded.has(key)} on:click|stopPropagation={() => toggle(key)}>
                    {expanded.has(key) ? '−' : '+'}
                  </button>
                  {#if person.username}
                    <strong>{person.username}</strong> <span class="sub">{person.email}</span>
                  {:else}
                    <strong>Hackatime user #{person.hackatimeUserId}</strong> <span class="sub">no Spaces account matched</span>
                  {/if}
                </td>
                <td>{hours(person.seconds)}</td>
                <td>{person.spaces.length}</td>
                <td>{when(person.firstAt)}</td>
                <td>{when(person.lastAt)}</td>
              </tr>
              {#if expanded.has(key)}
                {#each person.spaces as space (`${space.machine}|${space.source}`)}
                  <tr class="space-row">
                    <td>
                      {#if space.spaceId}
                        {space.name ?? `Space #${space.spaceId}`} <span class="sub">#{space.spaceId} · {space.typeLabel}</span>
                      {:else}
                        Old server machine <code>{space.machine || 'unknown'}</code>
                      {/if}
                      {#if space.source === 'hetzner'}<span class="tag">old server</span>{/if}
                    </td>
                    <td>{hours(space.seconds)}</td>
                    <td></td>
                    <td>{when(space.firstAt)}</td>
                    <td>{when(space.lastAt)}</td>
                  </tr>
                {/each}
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="note">No Hackatime time recorded for this period yet.</p>
    {/if}
  {/if}
</section>

<style>
  .filters {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .section {
    margin: 24px 0 0 0;
    font-size: 15px;
  }

  .type-row {
    cursor: pointer;
  }

  .type-row:hover {
    background: rgba(0, 0, 0, 0.03);
  }

  .type-row.selected {
    background: rgba(236, 55, 80, 0.08);
  }

  .bar {
    display: block;
    width: 80px;
    height: 4px;
    margin-top: 4px;
    border-radius: 2px;
    background: #eee;
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: #ec3750;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  .period {
    padding: 8px 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 12px;
  }

  .card {
    padding: 16px;
    border: 1px solid #ddd;
    border-radius: 8px;
  }

  .card h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: #666;
  }

  .big {
    margin: 0;
    font-size: 28px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
  }

  .range {
    margin: 0;
    font-size: 14px;
    font-weight: bold;
  }

  .sub {
    margin: 4px 0 0 0;
    font-size: 12px;
    color: #666;
  }

  .note {
    font-size: 13px;
    color: #555;
    margin: 8px 0;
  }

  .note.warn {
    color: #b45309;
  }

  .note.error {
    color: #c82333;
  }

  .import {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin: 16px 0;
  }

  .btn {
    padding: 8px 14px;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .table-wrap {
    overflow-x: auto;
    margin-top: 16px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }

  th,
  td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid #eee;
    white-space: nowrap;
  }

  td:nth-child(2) {
    font-variant-numeric: tabular-nums;
  }

  .person {
    cursor: pointer;
  }

  .person:hover {
    background: rgba(0, 0, 0, 0.03);
  }

  .space-row td:first-child {
    padding-left: 44px;
  }

  .expand {
    width: 22px;
    height: 22px;
    margin-right: 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    line-height: 1;
  }

  .tag {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    background: #eee;
  }

  code {
    font-size: 12px;
  }
</style>
