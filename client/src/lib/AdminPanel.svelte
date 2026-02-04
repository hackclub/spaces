<script>
  import { onMount } from 'svelte';
  import { API_BASE } from '../config.js';

  let analytics = { totalUsers: 0, totalSpaces: 0, activeSpaces: 0 };
  let users = [];
  let spaces = [];
  let loading = false;
  let activeTab = 'analytics';
  let spaceSearch = '';
  let spaceSortBy = 'id';

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
        await loadData();
      }
    } catch (err) {
      console.error('Failed to delete space:', err);
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
      </div>
    {/if}

    {#if activeTab === 'users'}
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
            {#each users as user}
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
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
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
            {#each filteredSpaces as space}
              <tr>
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
</style>
