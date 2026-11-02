<script>
  import { onMount } from 'svelte';
  import { API_BASE } from '../config.js';

  let analytics = {
    totalUsers: 0,
    totalSpaces: 0,
    activeSpaces: 0,
    inactiveSpaces: 0,
    inactiveDays: 90
  };
  let sandboxStats = null;
  let users = [];
  let spaces = [];
  let loadingAnalytics = true;
  let loadingSandboxStats = true;
  let loadingUsers = true;
  let loadingSpaces = true;
  let deletingInactive = false;
  let activeTab = 'analytics';
  const PAGE_SIZE = 100;
  const VERIFIED_STATUSES = ['verified', 'verified_eligible', 'verified_but_over_18'];
  let userSearch = '';
  let userFilter = 'all';
  let userSort = 'newest';
  let userLimit = PAGE_SIZE;
  let spaceSearch = '';
  let spaceType = 'all';
  let spaceStatus = 'all';
  let spaceSort = 'newest';
  let spaceLimit = PAGE_SIZE;
  let selectedSpaces = new Set();

  $: allSelected = shownSpaces.length > 0 && shownSpaces.every(s => selectedSpaces.has(s.id));

  function removeSpacesLocally(deletedIds) {
    const ids = new Set(deletedIds);
    const removed = spaces.filter(space => ids.has(space.id));
    if (removed.length === 0) return;

    spaces = spaces.filter(space => !ids.has(space.id));

    const removedPerUser = new Map();
    for (const space of removed) {
      removedPerUser.set(space.user_id, (removedPerUser.get(space.user_id) || 0) + 1);
    }
    users = users.map((user) => {
      const count = removedPerUser.get(user.id);
      return count ? { ...user, spaceCount: Math.max(0, user.spaceCount - count) } : user;
    });

    analytics = {
      ...analytics,
      totalSpaces: Math.max(0, analytics.totalSpaces - removed.length),
      activeSpaces: Math.max(0, analytics.activeSpaces - removed.filter(s => s.running).length)
    };
  }

  function toggleSpaceSelection(spaceId) {
    if (selectedSpaces.has(spaceId)) {
      selectedSpaces.delete(spaceId);
    } else {
      selectedSpaces.add(spaceId);
    }
    selectedSpaces = selectedSpaces;
  }

  function toggleSelectAll() {
    if (allSelected) {
      selectedSpaces = new Set();
    } else {
      selectedSpaces = new Set(shownSpaces.map(s => s.id));
    }
  }

  async function deleteSelectedSpaces() {
    if (selectedSpaces.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedSpaces.size} space(s)?`)) return;

    const deleted = [];
    for (const spaceId of selectedSpaces) {
      try {
        const response = await fetch(`${API_BASE}/admin/spaces/${spaceId}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        });
        if (response.ok) deleted.push(spaceId);
      } catch (err) {
        console.error(`Failed to delete space ${spaceId}:`, err);
      }
    }
    removeSpacesLocally(deleted);
    selectedSpaces = new Set();
  }

  function formatBytes(bytes = 0) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const scaled = value / Math.pow(1024, exponent);
    return `${scaled.toFixed(scaled >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }

  const time = (value) => (value ? new Date(value).getTime() : 0);
  const lastOpened = (space) => space.last_opened_at || space.started_at;
  const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');

  function matches(search, values) {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return values.some((value) => value != null && String(value).toLowerCase().includes(needle));
  }

  function hackClubLabel(user) {
    if (!user.hackclub_linked) return '—';
    if (VERIFIED_STATUSES.includes(user.hackclub_verification_status)) return 'Verified';
    return user.hackclub_verification_status?.replaceAll('_', ' ') || 'Linked';
  }

  function isInactive(space) {
    const cutoff = Date.now() - (analytics.inactiveDays ?? 90) * 24 * 60 * 60 * 1000;
    return !space.running && time(lastOpened(space) || space.created_at) < cutoff;
  }

  function showSpacesOf(user) {
    spaceSearch = user.email;
    spaceType = 'all';
    spaceStatus = 'all';
    activeTab = 'spaces';
  }

  const userFilters = {
    all: () => true,
    admins: (user) => user.is_admin,
    leaders: (user) => user.club_leader,
    members: (user) => user.in_club && !user.club_leader,
    verified: (user) => VERIFIED_STATUSES.includes(user.hackclub_verification_status),
    linked: (user) => user.hackclub_linked,
    unlinked: (user) => !user.hackclub_linked,
    password: (user) => user.has_password,
    running: (user) => user.runningCount > 0,
    withSpaces: (user) => user.spaceCount > 0,
    noSpaces: (user) => user.spaceCount === 0
  };

  const userSorts = {
    newest: (a, b) => b.id - a.id,
    oldest: (a, b) => a.id - b.id,
    active: (a, b) => time(b.last_active) - time(a.last_active),
    spaces: (a, b) => b.spaceCount - a.spaceCount || b.id - a.id,
    username: (a, b) => (a.username || '').localeCompare(b.username || '')
  };

  const spaceStatuses = {
    all: () => true,
    running: (space) => space.running,
    stopped: (space) => !space.running,
    favorite: (space) => space.is_favorite,
    inactive: isInactive,
    never: (space) => !lastOpened(space)
  };

  const spaceSorts = {
    newest: (a, b) => b.id - a.id,
    oldest: (a, b) => a.id - b.id,
    opened: (a, b) => time(lastOpened(b)) - time(lastOpened(a)),
    owner: (a, b) => (a.username || '').localeCompare(b.username || '') || b.id - a.id,
    type: (a, b) => (a.type || '').localeCompare(b.type || '') || b.id - a.id
  };

  $: spaceTypes = [...new Set(spaces.map(space => space.type).filter(Boolean))].sort();

  $: userSearch, userFilter, userSort, (userLimit = PAGE_SIZE);
  $: spaceSearch, spaceType, spaceStatus, spaceSort, (spaceLimit = PAGE_SIZE);

  $: filteredUsers = users
    .filter(userFilters[userFilter])
    .filter(user => matches(userSearch, [user.id, user.email, user.username]))
    .sort(userSorts[userSort]);
  $: shownUsers = filteredUsers.slice(0, userLimit);

  $: filteredSpaces = spaces
    .filter(space => spaceType === 'all' || space.type === spaceType)
    .filter(spaceStatuses[spaceStatus])
    .filter(space => matches(spaceSearch, [space.id, space.name, space.type, space.username, space.email, space.container_id]))
    .sort(spaceSorts[spaceSort]);
  $: shownSpaces = filteredSpaces.slice(0, spaceLimit);

  onMount(() => {
    loadData();
  });

  function loadData() {
    loadAnalytics();
    loadSandboxStats();
    loadUsers();
    loadSpaces();
  }

  async function loadAnalytics() {
    try {
      const response = await fetch(`${API_BASE}/admin/analytics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        analytics = data.data;
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      loadingAnalytics = false;
    }
  }

  async function loadSandboxStats() {
    try {
      const response = await fetch(`${API_BASE}/admin/sandbox-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await response.json();
      sandboxStats = response.ok ? data.data : null;
    } catch (err) {
      console.error('Failed to load sandbox stats:', err);
      sandboxStats = null;
    } finally {
      loadingSandboxStats = false;
    }
  }

  async function loadUsers() {
    try {
      const response = await fetch(`${API_BASE}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        users = data.data;
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      loadingUsers = false;
    }
  }

  async function loadSpaces() {
    try {
      const response = await fetch(`${API_BASE}/admin/spaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        spaces = data.data;
      }
    } catch (err) {
      console.error('Failed to load spaces:', err);
    } finally {
      loadingSpaces = false;
    }
  }

  async function updateUser(userId, updates) {
    try {
      const response = await fetch(`${API_BASE}/admin/users/${userId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates)
      });
      if (response.ok) {
        await loadUsers();
        await loadAnalytics();
      }
    } catch (err) {
      console.error('Failed to update user:', err);
    }
  }

  async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user and all their spaces?')) return;
    
    try {
      const response = await fetch(`${API_BASE}/admin/users/${userId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      if (response.ok) {
        loadData();
      }
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  }

  async function deleteSpace(spaceId) {
    if (!confirm('Are you sure you want to delete this space?')) return;
    
    try {
      const response = await fetch(`${API_BASE}/admin/spaces/${spaceId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      if (response.ok) {
        removeSpacesLocally([spaceId]);
      }
    } catch (err) {
      console.error('Failed to delete space:', err);
    }
  }

  async function deleteInactiveSpaces() {
    if (!confirm('Are you sure you want to delete all spaces that have been stopped for 90 days or more? This action is irreversible.')) return;

    try {
      deletingInactive = true;
      const response = await fetch(`${API_BASE}/admin/spaces/delete-inactive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        alert(data.message || 'Inactive spaces deleted successfully');
        loadData();
      } else {
        alert(data.message || 'Failed to delete inactive spaces');
      }
    } catch (err) {
      console.error('Failed to delete inactive spaces:', err);
      alert('Error deleting inactive spaces');
    } finally {
      deletingInactive = false;
    }
  }

  function handleMaxSpacesChange(userId, newValue) {
    const value = parseInt(newValue);
    if (!isNaN(value) && value >= 0) {
      updateUser(userId, { max_spaces: value });
    }
  }

  function toggleAdmin(userId, currentValue) {
    updateUser(userId, { is_admin: !currentValue });
  }
</script>

<div class="admin-panel">
  <h1>Admin Panel</h1>

  <div class="tabs">
    <button class:active={activeTab === 'analytics'} on:click={() => activeTab = 'analytics'}>Analytics</button>
    <button class:active={activeTab === 'users'} on:click={() => activeTab = 'users'}>Users</button>
    <button class:active={activeTab === 'spaces'} on:click={() => activeTab = 'spaces'}>Spaces</button>
  </div>

  {#if activeTab === 'analytics'}
    {#if loadingAnalytics}
      <p class="loading-note">Loading stats...</p>
    {:else}
      <div class="analytics">
        <div class="stat-card">
          <h3>Total Users</h3>
          <p class="stat">{analytics.totalUsers}</p>
        </div>
        <div class="stat-card">
          <h3>Total Spaces</h3>
          <p class="stat">{analytics.totalSpaces}</p>
        </div>
        <div class="stat-card">
          <h3>Active Spaces</h3>
          <p class="stat">{analytics.activeSpaces}</p>
        </div>
        <div class="stat-card">
          <h3>Inactive &gt; {analytics.inactiveDays ?? 90}d</h3>
          <p class="stat">{analytics.inactiveSpaces ?? 0}</p>
        </div>
      </div>
    {/if}

    <h2 class="section-heading">Sandboxes</h2>
    {#if loadingSandboxStats}
      <p class="loading-note">Loading sandbox stats from Vercel...</p>
    {:else if sandboxStats}
      <div class="analytics">
        <div class="stat-card">
          <h3>Sandboxes</h3>
          <p class="stat">{sandboxStats.sandboxes}</p>
          <p class="stat-sub">{sandboxStats.running} running now</p>
        </div>
        <div class="stat-card">
          <h3>Snapshot Storage</h3>
          <p class="stat">{formatBytes(sandboxStats.snapshotBytes)}</p>
          <p class="stat-sub">{sandboxStats.snapshots} snapshot(s)</p>
        </div>
        <div class="stat-card">
          <h3>Average per Snapshot</h3>
          <p class="stat">{formatBytes(sandboxStats.snapshots ? sandboxStats.snapshotBytes / sandboxStats.snapshots : 0)}</p>
          <p class="stat-sub">saved when a space stops</p>
        </div>
      </div>
    {:else}
      <p class="stat-sub">Couldn't load sandbox stats from Vercel.</p>
    {/if}
  {/if}

  {#if activeTab === 'users'}
    <div class="spaces-controls">
      <input
        type="text"
        placeholder="Search by ID, username, or email..."
        bind:value={userSearch}
        class="search-input"
      />
      <select bind:value={userFilter} class="sort-select">
        <option value="all">All users</option>
        <option value="admins">Admins</option>
        <option value="leaders">Club leaders</option>
        <option value="members">Club members</option>
        <option value="verified">Hack Club verified</option>
        <option value="linked">Hack Club linked</option>
        <option value="unlinked">No Hack Club account</option>
        <option value="password">Club password login</option>
        <option value="running">Space running now</option>
        <option value="withSpaces">Has spaces</option>
        <option value="noSpaces">No spaces</option>
      </select>
      <select bind:value={userSort} class="sort-select">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="active">Recently active</option>
        <option value="spaces">Most spaces</option>
        <option value="username">Username A–Z</option>
      </select>
      <span class="result-count">{filteredUsers.length} of {users.length}</span>
    </div>
    {#if loadingUsers}
      <p class="loading-note">Loading users...</p>
    {:else}
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Email</th>
              <th>Username</th>
              <th>Hack Club</th>
              <th>Club</th>
              <th>Spaces</th>
              <th>Last Active</th>
              <th>Joined</th>
              <th>Max Spaces</th>
              <th>Admin</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each shownUsers as user (user.id)}
              <tr>
                <td>{user.id}</td>
                <td>{user.email}</td>
                <td>{user.username}</td>
                <td>{hackClubLabel(user)}</td>
                <td>{user.club_leader ? 'Leader' : user.in_club ? 'Member' : '—'}</td>
                <td>
                  {#if user.spaceCount > 0}
                    <button class="link-btn" on:click={() => showSpacesOf(user)}>{user.spaceCount}</button>
                    {#if user.runningCount > 0}<span class="stat-sub"> ({user.runningCount} running)</span>{/if}
                  {:else}
                    0
                  {/if}
                </td>
                <td>{formatDate(user.last_active)}</td>
                <td>{formatDate(user.created_at)}</td>
                <td>
                  <input
                    type="number"
                    value={user.max_spaces}
                    on:change={(e) => handleMaxSpacesChange(user.id, e.target.value)}
                    min="0"
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={user.is_admin}
                    on:change={() => toggleAdmin(user.id, user.is_admin)}
                  />
                </td>
                <td>
                  <button on:click={() => deleteUser(user.id)} class="delete-btn">Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if filteredUsers.length > shownUsers.length}
        <button class="show-more-btn" on:click={() => (userLimit += PAGE_SIZE)}>
          Show more ({filteredUsers.length - shownUsers.length} left)
        </button>
      {/if}
    {/if}
  {/if}

  {#if activeTab === 'spaces'}
    <div class="spaces-controls">
      <input
        type="text"
        placeholder="Search by ID, name, owner, email, or sandbox..."
        bind:value={spaceSearch}
        class="search-input"
      />
      <select bind:value={spaceType} class="sort-select">
        <option value="all">All types</option>
        {#each spaceTypes as type}
          <option value={type}>{type}</option>
        {/each}
      </select>
      <select bind:value={spaceStatus} class="sort-select">
        <option value="all">Any status</option>
        <option value="running">Running</option>
        <option value="stopped">Stopped</option>
        <option value="favorite">Favourited</option>
        <option value="inactive">Inactive &gt; {analytics.inactiveDays ?? 90} days</option>
        <option value="never">Never opened</option>
      </select>
      <select bind:value={spaceSort} class="sort-select">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="opened">Recently opened</option>
        <option value="owner">Owner A–Z</option>
        <option value="type">Type</option>
      </select>
      <span class="result-count">{filteredSpaces.length} of {spaces.length}</span>
    </div>
    <div class="spaces-controls">
      {#if selectedSpaces.size > 0}
        <button on:click={deleteSelectedSpaces} class="delete-selected-btn">
          Delete Selected ({selectedSpaces.size})
        </button>
      {/if}
      <button on:click={deleteInactiveSpaces} class="delete-inactive-btn" disabled={deletingInactive}>
        {deletingInactive ? 'Deleting...' : `Delete Spaces Inactive > ${analytics.inactiveDays ?? 90} Days`}
      </button>
    </div>
    {#if loadingSpaces}
      <p class="loading-note">Loading spaces...</p>
    {:else}
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allSelected} on:change={toggleSelectAll} /></th>
              <th>ID</th>
              <th>Name</th>
              <th>Type</th>
              <th>Owner</th>
              <th>Email</th>
              <th>Status</th>
              <th>Last Opened</th>
              <th>Created</th>
              <th>Sandbox</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each shownSpaces as space (space.id)}
              <tr>
                <td><input type="checkbox" checked={selectedSpaces.has(space.id)} on:change={() => toggleSpaceSelection(space.id)} /></td>
                <td>{space.id}</td>
                <td>{space.name ?? '—'}</td>
                <td>{space.type}</td>
                <td>{space.username}</td>
                <td>{space.email}</td>
                <td>{space.running ? 'Running' : 'Stopped'}</td>
                <td>{lastOpened(space) ? new Date(lastOpened(space)).toLocaleString() : 'Never'}</td>
                <td>{formatDate(space.created_at)}</td>
                <td class="sandbox-name">{space.container_id ?? '—'}</td>
                <td>
                  <button on:click={() => deleteSpace(space.id)} class="delete-btn">Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if filteredSpaces.length > shownSpaces.length}
        <button class="show-more-btn" on:click={() => (spaceLimit += PAGE_SIZE)}>
          Show more ({filteredSpaces.length - shownSpaces.length} left)
        </button>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .admin-panel {
    padding: 20px;
    max-width: 1200px;
    margin: 0 auto;
  }

  h1 {
    margin-bottom: 30px;
  }

  .tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    border-bottom: 2px solid #ddd;
  }

  .tabs button {
    padding: 10px 20px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    border-bottom: 3px solid transparent;
  }

  .tabs button.active {
    border-bottom-color: #007bff;
    font-weight: bold;
  }

  .analytics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
  }

  .stat-card {
    padding: 20px;
    border: 1px solid #ddd;
    border-radius: 8px;
    text-align: center;
  }

  .stat-card h3 {
    margin: 0 0 10px 0;
    font-size: 14px;
    color: #666;
  }

  .stat {
    font-size: 32px;
    font-weight: bold;
    margin: 0;
  }

  .stat-sub {
    margin: 6px 0 0 0;
    font-size: 12px;
    color: #666;
  }

  .section-heading {
    margin: 32px 0 16px 0;
    font-size: 18px;
  }

  .sandbox-name {
    font-family: monospace;
    font-size: 12px;
  }

  .result-count {
    font-size: 13px;
    color: #666;
    white-space: nowrap;
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

  input[type="number"] {
    width: 60px;
    padding: 5px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  input[type="checkbox"] {
    cursor: pointer;
  }

  .delete-btn {
    padding: 5px 10px;
    background-color: #dc3545;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .delete-btn:hover {
    background-color: #c82333;
  }

  .spaces-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 15px;
  }

  .loading-note {
    color: #666;
  }

  .link-btn {
    padding: 0;
    background: none;
    border: none;
    color: #007bff;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }

  .show-more-btn {
    display: block;
    margin: 15px auto 0;
    padding: 8px 16px;
    background: none;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .show-more-btn:hover {
    border-color: #007bff;
  }

  .delete-inactive-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .search-input {
    flex: 1;
    min-width: 220px;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
  }

  .sort-select {
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
  }

  .delete-selected-btn {
    padding: 8px 16px;
    background-color: #dc3545;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .delete-selected-btn:hover {
    background-color: #c82333;
  }

  .delete-inactive-btn {
    padding: 8px 16px;
    background-color: #e67e22;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: background-color 0.2s, transform 0.1s;
  }

  .delete-inactive-btn:hover {
    background-color: #d35400;
  }

  .delete-inactive-btn:active {
    transform: scale(0.98);
  }
</style>
