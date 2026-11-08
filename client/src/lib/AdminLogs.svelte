<script>
  import { onMount } from 'svelte';
  import { API_BASE } from '../config.js';

  const LABELS = {
    'user.limits': 'Changed limits',
    'user.roles': 'Changed roles',
    'user.superadmin': 'Changed superadmin',
    'role.create': 'Created role',
    'role.update': 'Edited role',
    'role.delete': 'Deleted role',
    'user.beta': 'Changed beta access',
    'user.sign_out': 'Signed out everywhere',
    'user.stop_spaces': 'Stopped running spaces',
    'user.delete': 'Deleted user',
    'space.delete': 'Deleted space',
    'space.lock': 'Locked space',
    'space.unlock': 'Unlocked space',
    'space.browse': 'Browsed files',
    'space.read': 'Opened file',
    'space.download': 'Downloaded file',
    'space.full_access': 'Opened space (full access)',
    'space.release': 'Stopped space after moderation'
  };

  let entries = [];
  let actions = [];
  let action = '';
  let search = '';
  let hasMore = false;
  let loading = false;
  let error = '';
  let searchTimer;

  const label = (name) => LABELS[name] || name;

  const roleText = (roles) => (roles?.is_superadmin ? 'superadmin' : roles?.is_admin ? 'admin' : 'user');

  function describe(entry) {
    const d = entry.details || {};
    switch (entry.action) {
      case 'user.limits': return Object.entries(d).map(([field, change]) => `${field === 'max_running' ? 'running at once' : 'max spaces'} ${change.from} → ${change.to}`).join(', ');
      case 'user.roles': return d.from ? `${roleText(d.from)} → ${roleText(d.to)}` : [...(d.added ?? []).map((name) => `+${name}`), ...(d.removed ?? []).map((name) => `−${name}`)].join(', ');
      case 'user.superadmin': return d.to ? 'made superadmin' : 'superadmin removed';
      case 'role.create': return `${d.name}: ${(d.permissions ?? []).length} permission${d.permissions?.length === 1 ? '' : 's'}`;
      case 'role.update': return [d.renamed_from ? `${d.renamed_from} → ${d.name}` : d.name, ...(d.added ?? []).map((key) => `+${key}`), ...(d.removed ?? []).map((key) => `−${key}`)].join(', ');
      case 'role.delete': return d.name;
      case 'user.beta': return d.to ? 'given' : 'removed';
      case 'user.sign_out': return `${d.sessions} device${d.sessions === 1 ? '' : 's'}`;
      case 'user.stop_spaces': return d.spaces?.length ? d.spaces.map((id) => `#${id}`).join(', ') : 'none running';
      case 'user.delete': return `${d.username ?? ''}, ${d.spaces?.length ?? 0} space${d.spaces?.length === 1 ? '' : 's'}`;
      case 'space.delete': return [d.type, d.name].filter(Boolean).join(' · ');
      default: return d.path ?? (Object.keys(d).length ? JSON.stringify(d) : '');
    }
  }

  function target(entry) {
    const parts = [];
    if (entry.target_email) parts.push(entry.target_email);
    if (entry.target_space_id) parts.push(`space #${entry.target_space_id}${entry.target_space_name ? ` (${entry.target_space_name})` : ''}`);
    return parts.join(' · ') || '—';
  }

  async function load(more = false) {
    loading = true;
    error = '';
    try {
      const response = await fetch(`${API_BASE}/admin/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: action || null,
          search: search || null,
          before: more && entries.length ? entries[entries.length - 1].id : null
        })
      });
      const data = await response.json();
      if (!response.ok) {
        error = data.message || "Couldn't load the log.";
        return;
      }
      entries = more ? [...entries, ...data.data.entries] : data.data.entries;
      actions = data.data.actions;
      hasMore = data.data.hasMore;
    } catch (err) {
      error = "Couldn't load the log.";
    } finally {
      loading = false;
    }
  }

  function searchChanged() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(), 300);
  }

  onMount(() => load());
</script>

<div class="spaces-controls">
  <input type="text" class="search-input" placeholder="Search by email or space ID..." bind:value={search} on:input={searchChanged} />
  <select class="sort-select" bind:value={action} on:change={() => load()}>
    <option value="">All actions</option>
    {#each actions as name}
      <option value={name}>{label(name)}</option>
    {/each}
  </select>
</div>
<p class="stat-sub">Everything admins and superadmins do. Only superadmins can see this.</p>

{#if error}
  <p class="stat-sub">{error}</p>
{:else if loading && entries.length === 0}
  <p class="loading-note">Loading log...</p>
{:else}
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Who</th>
          <th>Action</th>
          <th>Target</th>
          <th>Details</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {#each entries as entry (entry.id)}
          <tr>
            <td>{new Date(entry.created_at).toLocaleString()}</td>
            <td>{entry.actor_email ?? '—'}</td>
            <td>{label(entry.action)}</td>
            <td>{target(entry)}</td>
            <td class="details">{describe(entry)}</td>
            <td>{entry.reason ?? '—'}</td>
          </tr>
        {:else}
          <tr><td colspan="6">Nothing logged yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if hasMore}
    <button class="show-more-btn" disabled={loading} on:click={() => load(true)}>{loading ? 'Loading...' : 'Show older'}</button>
  {/if}
{/if}

<style>
  .spaces-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 15px;
  }

  .search-input {
    flex: 1;
    min-width: 200px;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  .sort-select {
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  .stat-sub {
    margin: 6px 0 0 0;
    font-size: 12px;
    color: #666;
  }

  .loading-note {
    color: #666;
  }

  .table-container {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
  }

  th, td {
    padding: 10px;
    text-align: left;
    border-bottom: 1px solid #ddd;
  }

  th {
    background-color: #f5f5f5;
    font-weight: bold;
  }

  .details {
    font-size: 13px;
    word-break: break-word;
  }

  .show-more-btn {
    display: block;
    margin: 15px auto 0;
    padding: 8px 16px;
    background: none;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
