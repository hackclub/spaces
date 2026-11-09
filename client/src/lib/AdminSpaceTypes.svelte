<script>
  import { onMount } from 'svelte';
  import { API_BASE } from '../config.js';

  let types = [];
  let loading = true;
  let error = '';
  let rebuilding = '';
  let message = '';

  const KIND_LABELS = { editor: 'Code editor', gui: 'Desktop app', web: 'Web app' };

  function formatBytes(bytes) {
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  }

  const when = (value) => (value ? new Date(value).toLocaleString() : '—');

  function versionText(item, version) {
    if (version.current) return version.current;
    if (!version.fromTemplate) return 'always the newest';
    if (item.template?.current) return 'not recorded yet, rebuild to see it';
    return 'unknown until the template is built';
  }

  function templateStatus(template) {
    if (template.current) return 'Ready';
    return template.builtAt ? 'Outdated, using the slow path' : 'Not built, using the slow path';
  }

  async function load() {
    try {
      const response = await fetch(`${API_BASE}/admin/space-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to load space types');
      types = data.data;
      error = '';
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function rebuild(type = null) {
    rebuilding = type ?? 'all';
    message = '';
    try {
      const response = await fetch(`${API_BASE}/admin/templates/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(type ? { type } : {})
      });
      const data = await response.json();
      if (data.data?.types) types = data.data.types;
      const failed = (data.data?.results || []).filter((result) => !result.ok);
      message = response.ok && !failed.length
        ? type ? `${types.find((item) => item.type === type)?.title ?? type} template rebuilt.` : 'All templates rebuilt.'
        : failed.length
          ? `Couldn't rebuild ${failed.map((result) => result.type).join(', ')}: ${failed[0].error}`
          : data.message || 'Failed to rebuild';
    } catch (err) {
      message = 'Failed to rebuild';
    } finally {
      rebuilding = '';
    }
  }

  onMount(load);
</script>

<section class="space-types">
  <div class="head">
    <div>
      <h2>Space types</h2>
      <p class="note">
        Desktop apps start from templates, so they skip installing and downloading the app. Templates rebuild by themselves once a week,
        or within a day when a type's image changes. Rebuilding picks up the newest version of linuxserver images.
      </p>
    </div>
    <button class="btn" on:click={() => rebuild()} disabled={rebuilding !== ''}>
      {rebuilding === 'all' ? 'Rebuilding all, this takes a few minutes...' : 'Rebuild all templates'}
    </button>
  </div>

  {#if message}<p class="note result">{message}</p>{/if}

  {#if loading}
    <p class="note">Loading space types...</p>
  {:else if error}
    <p class="note error">{error}</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Versions</th>
            <th>Template</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each types as item (item.type)}
            <tr>
              <td>
                <strong>{item.title}</strong>
                {#if item.beta}<span class="tag beta">Beta</span>{/if}
                <span class="sub">{item.category} · {KIND_LABELS[item.kind] ?? item.kind}</span>
                {#if item.source}<code>{item.source}</code>{/if}
              </td>
              <td>
                <ul class="versions">
                  {#each item.versions as version}
                    <li>
                      <span class="version-name">{version.name}</span>
                      <span class="version-value" class:muted={!version.current}>{versionText(item, version)}</span>
                      <a href={version.latestUrl} target="_blank" rel="noopener noreferrer">latest ↗</a>
                      {#if version.note}<span class="sub">{version.note}</span>{/if}
                    </li>
                  {/each}
                </ul>
              </td>
              <td>
                {#if item.template}
                  <span class:ok={item.template.current} class="status">{templateStatus(item.template)}</span>
                  <span class="sub">Built {when(item.template.builtAt)}</span>
                  <span class="sub">{formatBytes(item.template.sizeBytes)}</span>
                {:else}
                  <span class="sub">No template, installs fresh each time</span>
                {/if}
              </td>
              <td>
                {#if item.template}
                  <button class="btn" on:click={() => rebuild(item.type)} disabled={rebuilding !== ''}>
                    {rebuilding === item.type ? 'Rebuilding...' : 'Rebuild'}
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  h2 {
    margin: 0 0 6px 0;
    font-size: 18px;
  }

  .note {
    margin: 0;
    font-size: 13px;
    color: #555;
    max-width: 70ch;
  }

  .note.result {
    margin: 8px 0;
    color: #1e7e34;
  }

  .note.error {
    color: #c82333;
  }

  .btn {
    padding: 8px 14px;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .table-wrap {
    overflow-x: auto;
    margin-top: 12px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }

  th,
  td {
    text-align: left;
    vertical-align: top;
    padding: 12px 10px;
    border-bottom: 1px solid #eee;
  }

  .sub {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    color: #666;
  }

  code {
    display: block;
    margin-top: 4px;
    font-size: 12px;
  }

  .tag {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
  }

  .tag.beta {
    background: #a633d6;
    color: #fff;
  }

  .versions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .version-name {
    font-weight: bold;
    margin-right: 6px;
  }

  .version-value {
    font-variant-numeric: tabular-nums;
    margin-right: 8px;
  }

  .version-value.muted {
    color: #666;
    font-style: italic;
  }

  .versions a {
    color: #007bff;
    font-size: 13px;
    white-space: nowrap;
  }

  .status {
    font-weight: bold;
    color: #b45309;
  }

  .status.ok {
    color: #1e7e34;
  }
</style>
