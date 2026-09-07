<script>
  import { onMount } from 'svelte';
  import { API_BASE } from '../config.js';

  const emptyDisk = { path: '', total: 0, free: 0, used: 0 };
  const emptyDockerEntry = { count: 0, size: 0 };

  let analytics = {
    totalUsers: 0,
    totalSpaces: 0,
    activeSpaces: 0,
    inactiveSpaces: 0,
    inactiveDays: 90
  };
  let storage = {
    root: { ...emptyDisk },
    volume: { ...emptyDisk },
    docker: {
      images: { ...emptyDockerEntry },
      containers: { ...emptyDockerEntry },
      volumes: { ...emptyDockerEntry }
    }
  };
  let users = [];
  let spaces = [];
  let loading = false;
  let activeTab = 'analytics';
  let userSearch = '';
  let spaceSearch = '';
  let spaceSortBy = 'id';
  let selectedSpaces = new Set();

  $: allSelected = filteredSpaces.length > 0 && filteredSpaces.every(s => selectedSpaces.has(s.id));

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
      selectedSpaces = new Set(filteredSpaces.map(s => s.id));
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

  $: diskCards = [
    { label: 'System Disk', disk: storage.root },
    { label: 'User Data', disk: storage.volume }
  ]
    .filter(entry => (entry.disk?.total ?? 0) > 0)
    .map(entry => ({
      label: entry.label,
      path: entry.disk?.path ?? '',
      used: entry.disk?.used ?? 0,
      total: entry.disk?.total ?? 0,
      free: entry.disk?.free ?? 0,
      percent: Math.round(((entry.disk?.used ?? 0) / (entry.disk?.total || 1)) * 100)
    }));

  $: filteredUsers = users.filter((user) => {
    if (!userSearch) return true;
    const search = userSearch.toLowerCase();
    return (
      user.id.toString().includes(search) ||
      user.email?.toLowerCase().includes(search) ||
      user.username?.toLowerCase().includes(search)
    );
  });

  $: filteredSpaces = spaces
    .filter(space => {
      if (!spaceSearch) return true;
      const search = spaceSearch.toLowerCase();
      return (
        space.id.toString().includes(search) ||
        space.type?.toLowerCase().includes(search) ||
        space.username?.toLowerCase().includes(search) ||
        space.email?.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => {
      if (spaceSortBy === 'started_at') {
        const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
        const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
        return bTime - aTime;
      }
      return b.id - a.id;
    });

  onMount(() => {
    loadData();
  });

  async function loadData() {
    loading = true;
    await Promise.all([
      loadAnalytics(),
      loadUsers(),
      loadSpaces()
    ]);
    loading = false;
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
        storage = {
          root: data.data.storage?.root ?? { ...emptyDisk },
          volume: data.data.storage?.volume ?? { ...emptyDisk },
          docker: data.data.storage?.docker ?? {
            images: { ...emptyDockerEntry },
            containers: { ...emptyDockerEntry },
            volumes: { ...emptyDockerEntry }
          }
        };
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
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
        await loadData();
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
      loading = true;
      const response = await fetch(`${API_BASE}/admin/spaces/delete-inactive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        alert(data.message || 'Inactive spaces deleted successfully');
        await loadData();
      } else {
        alert(data.message || 'Failed to delete inactive spaces');
      }
    } catch (err) {
      console.error('Failed to delete inactive spaces:', err);
      alert('Error deleting inactive spaces');
    } finally {
      loading = false;
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

  {#if loading}
    <p>Loading...</p>
  {:else}
    <div class="tabs">
      <button class:active={activeTab === 'analytics'} on:click={() => activeTab = 'analytics'}>Analytics</button>
      <button class:active={activeTab === 'users'} on:click={() => activeTab = 'users'}>Users</button>
      <button class:active={activeTab === 'spaces'} on:click={() => activeTab = 'spaces'}>Spaces</button>
    </div>

    {#if activeTab === 'analytics'}
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

      {#if storage}
        <h2 class="section-heading">Storage</h2>
        <div class="analytics">
          {#each diskCards as disk}
            <div class="stat-card">
              <h3>{disk.label}</h3>
              <p class="stat" class:stat-warn={disk.percent >= 80} class:stat-danger={disk.percent >= 90}>
                {disk.percent}%
              </p>
              <p class="stat-sub">{formatBytes(disk.used)} of {formatBytes(disk.total)} used</p>
              <p class="stat-sub">{formatBytes(disk.free)} free</p>
            </div>
          {/each}

          {#if storage.docker}
            <div class="stat-card">
              <h3>Docker Images</h3>
              <p class="stat">{formatBytes(storage.docker.images.size)}</p>
              <p class="stat-sub">{storage.docker.images.count} image(s)</p>
            </div>
            <div class="stat-card">
              <h3>Docker Containers</h3>
              <p class="stat">{formatBytes(storage.docker.containers.size)}</p>
              <p class="stat-sub">{storage.docker.containers.count} container(s)</p>
            </div>
            <div class="stat-card">
              <h3>Docker Volumes</h3>
              <p class="stat">{formatBytes(storage.docker.volumes.size)}</p>
              <p class="stat-sub">{storage.docker.volumes.count} volume(s)</p>
            </div>
          {/if}
        </div>
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
        <span class="result-count">{filteredUsers.length} of {users.length}</span>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Email</th>
              <th>Username</th>
              <th>Spaces</th>
              <th>Max Spaces</th>
              <th>Admin</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredUsers as user (user.id)}
              <tr>
                <td>{user.id}</td>
                <td>{user.email}</td>
                <td>{user.username}</td>
                <td>{user.spaceCount}</td>
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
    {/if}

    {#if activeTab === 'spaces'}
      <div class="spaces-controls">
        <input 
          type="text" 
          placeholder="Search by ID, type, owner, or email..." 
          bind:value={spaceSearch}
          class="search-input"
        />
        <select bind:value={spaceSortBy} class="sort-select">
          <option value="id">Sort by ID</option>
          <option value="started_at">Sort by Last Turned On</option>
        </select>
        {#if selectedSpaces.size > 0}
          <button on:click={deleteSelectedSpaces} class="delete-selected-btn">
            Delete Selected ({selectedSpaces.size})
          </button>
        {/if}
        <button on:click={deleteInactiveSpaces} class="delete-inactive-btn">
          Delete Spaces Inactive &gt; 90 Days
        </button>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allSelected} on:change={toggleSelectAll} /></th>
              <th>ID</th>
              <th>Type</th>
              <th>Owner</th>
              <th>Email</th>
              <th>Status</th>
              <th>Last Turned On</th>
              <th>Port</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredSpaces as space (space.id)}
              <tr>
                <td><input type="checkbox" checked={selectedSpaces.has(space.id)} on:change={() => toggleSpaceSelection(space.id)} /></td>
                <td>{space.id}</td>
                <td>{space.type}</td>
                <td>{space.username}</td>
                <td>{space.email}</td>
                <td>{space.running ? 'Running' : 'Stopped'}</td>
                <td>{space.started_at ? new Date(space.started_at).toLocaleString() : 'Never'}</td>
                <td>{space.port}</td>
                <td>
                  <button on:click={() => deleteSpace(space.id)} class="delete-btn">Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
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

  .stat-warn {
    color: #b26a00;
  }

  .stat-danger {
    color: #c62828;
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
    gap: 10px;
    margin-bottom: 15px;
  }

  .search-input {
    flex: 1;
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
