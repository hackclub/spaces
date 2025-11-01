<script>
  import { createEventDispatcher } from 'svelte';
  
  export let spaces = [];
  export let authorization = '';
  export let username = '';
  
  const dispatch = createEventDispatcher();
  
  let showCreateForm = false;
  let newSpaceType = 'code-server';
  let newSpacePassword = '';
  let error = '';
  let loading = false;
  let actionLoading = {};
  
  const API_BASE = 'http://localhost:5678/api/v1';
  
  const spaceTypes = [
    { value: 'code-server', label: 'VS Code Server', description: 'Web-based code editor' },
    { value: 'blender', label: 'Blender 3D', description: '3D modeling and animation' },
    { value: 'kicad', label: 'KiCad', description: 'PCB design software' }
  ];
  
  async function createSpace() {
    error = '';
    loading = true;
    
    try {
      const response = await fetch(`${API_BASE}/spaces/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization,
        },
        body: JSON.stringify({ 
          password: newSpacePassword, 
          type: newSpaceType 
        }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        showCreateForm = false;
        newSpacePassword = '';
        await loadSpaces();
      } else {
        error = data.error || 'Failed to create space';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
    } finally {
      loading = false;
    }
  }
  
  async function loadSpaces() {
    try {
      const response = await fetch(`${API_BASE}/spaces/list`, {
        headers: {
          'Authorization': authorization,
        },
      });
      
      const data = await response.json();
      
      if (response.ok) {
        spaces = data.spaces;
      }
    } catch (err) {
      console.error('Failed to load spaces:', err);
    }
  }
  
  async function startSpace(spaceId) {
    actionLoading[spaceId] = 'starting';
    actionLoading = actionLoading;
    
    try {
      const response = await fetch(`${API_BASE}/spaces/start/${spaceId}`, {
        method: 'POST',
        headers: {
          'Authorization': authorization,
        },
      });
      
      const data = await response.json();
      
      if (response.ok) {
        await loadSpaces();
      } else {
        alert(data.error || 'Failed to start space');
      }
    } catch (err) {
      alert('Network error. Please try again.');
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }
  
  async function stopSpace(spaceId) {
    actionLoading[spaceId] = 'stopping';
    actionLoading = actionLoading;
    
    try {
      const response = await fetch(`${API_BASE}/spaces/stop/${spaceId}`, {
        method: 'POST',
        headers: {
          'Authorization': authorization,
        },
      });
      
      const data = await response.json();
      
      if (response.ok) {
        await loadSpaces();
      } else {
        alert(data.error || 'Failed to stop space');
      }
    } catch (err) {
      alert('Network error. Please try again.');
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }
  
  async function refreshStatus(spaceId) {
    actionLoading[spaceId] = 'refreshing';
    actionLoading = actionLoading;
    
    try {
      const response = await fetch(`${API_BASE}/spaces/status/${spaceId}`, {
        headers: {
          'Authorization': authorization,
        },
      });
      
      const data = await response.json();
      
      if (response.ok) {
        await loadSpaces();
      } else {
        alert(data.error || 'Failed to get status');
      }
    } catch (err) {
      alert('Network error. Please try again.');
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }
  
  function handleSignOut() {
    dispatch('signout');
  }
  
  function getStatusColor(status) {
    switch(status?.toLowerCase()) {
      case 'running': return '#22c55e';
      case 'stopped': return '#ef4444';
      case 'created': return '#eab308';
      default: return '#888';
    }
  }
</script>

<div class="dashboard">
  <header>
    <div>
      <h1>Hack Club Spaces</h1>
      <p class="welcome">Welcome, {username}!</p>
    </div>
    <button class="signout" on:click={handleSignOut}>Sign Out</button>
  </header>
  
  <div class="content">
    <div class="actions-bar">
      <button class="primary" on:click={() => showCreateForm = !showCreateForm}>
        {showCreateForm ? 'Cancel' : '+ Create New Space'}
      </button>
      <button class="secondary" on:click={loadSpaces}>
        Refresh
      </button>
    </div>
    
    {#if showCreateForm}
      <div class="create-form">
        <h3>Create New Space</h3>
        
        <div class="form-group">
          <label for="type">Space Type</label>
          <select id="type" bind:value={newSpaceType}>
            {#each spaceTypes as spaceType}
              <option value={spaceType.value}>
                {spaceType.label} - {spaceType.description}
              </option>
            {/each}
          </select>
        </div>
        
        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            type="password"
            bind:value={newSpacePassword}
            required
            placeholder="Set a password for this space"
          />
        </div>
        
        {#if error}
          <div class="error">{error}</div>
        {/if}
        
        <button 
          class="primary" 
          on:click={createSpace} 
          disabled={loading || !newSpacePassword}
        >
          {loading ? 'Creating...' : 'Create Space'}
        </button>
      </div>
    {/if}
    
    <div class="spaces-list">
      <h3>Your Spaces</h3>
      
      {#if spaces.length === 0}
        <div class="empty-state">
          <p>No spaces yet. Create your first space to get started!</p>
        </div>
      {:else}
        <div class="spaces-grid">
          {#each spaces as space}
            <div class="space-card">
              <div class="space-header">
                <h4>{space.type}</h4>
                <span 
                  class="status-badge" 
                  style="background-color: {getStatusColor(space.status)}"
                >
                  {space.status || 'Unknown'}
                </span>
              </div>
              
              <div class="space-info">
                <p><strong>Space ID:</strong> {space.space_id}</p>
                {#if space.url}
                  <p><strong>URL:</strong> 
                    <a href={space.url} target="_blank" rel="noopener noreferrer">
                      {space.url}
                    </a>
                  </p>
                {/if}
                <p><strong>Created:</strong> {new Date(space.created_at).toLocaleString()}</p>
              </div>
              
              <div class="space-actions">
                {#if actionLoading[space.space_id]}
                  <button disabled class="action-btn">
                    {actionLoading[space.space_id]}...
                  </button>
                {:else}
                  {#if space.status?.toLowerCase() === 'running'}
                    <button 
                      class="action-btn stop" 
                      on:click={() => stopSpace(space.space_id)}
                    >
                      Stop
                    </button>
                    {#if space.url}
                      <a 
                        href={space.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        class="action-btn open"
                      >
                        Open
                      </a>
                    {/if}
                  {:else}
                    <button 
                      class="action-btn start" 
                      on:click={() => startSpace(space.space_id)}
                    >
                      Start
                    </button>
                  {/if}
                  <button 
                    class="action-btn refresh" 
                    on:click={() => refreshStatus(space.space_id)}
                  >
                    ↻
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .dashboard {
    min-height: 100vh;
    padding: 2rem;
  }
  
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #333;
  }
  
  h1 {
    margin: 0;
    color: #ec3750;
  }
  
  .welcome {
    margin: 0.5rem 0 0 0;
    color: #888;
  }
  
  .signout {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid #ef4444;
    color: #ef4444;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;
  }
  
  .signout:hover {
    background: rgba(239, 68, 68, 0.1);
  }
  
  .content {
    max-width: 1200px;
    margin: 0 auto;
  }
  
  .actions-bar {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
  }
  
  .primary {
    background: #646cff;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.3s;
  }
  
  .primary:hover:not(:disabled) {
    background: #535bf2;
  }
  
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .secondary {
    background: transparent;
    border: 1px solid #646cff;
    color: #646cff;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;
  }
  
  .secondary:hover {
    background: rgba(100, 108, 255, 0.1);
  }
  
  .create-form {
    background: rgba(255, 255, 255, 0.05);
    padding: 2rem;
    border-radius: 12px;
    margin-bottom: 2rem;
  }
  
  .create-form h3 {
    margin-top: 0;
  }
  
  .form-group {
    margin-bottom: 1.5rem;
  }
  
  label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
  }
  
  input, select {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #444;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
    font-size: 1rem;
    box-sizing: border-box;
  }
  
  input:focus, select:focus {
    outline: none;
    border-color: #646cff;
  }
  
  .error {
    padding: 0.75rem;
    margin-bottom: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #ef4444;
  }
  
  .spaces-list h3 {
    margin-bottom: 1.5rem;
  }
  
  .empty-state {
    text-align: center;
    padding: 3rem;
    color: #888;
  }
  
  .spaces-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1.5rem;
  }
  
  .space-card {
    background: rgba(255, 255, 255, 0.05);
    padding: 1.5rem;
    border-radius: 12px;
    border: 1px solid #333;
    transition: all 0.3s;
  }
  
  .space-card:hover {
    border-color: #646cff;
    box-shadow: 0 4px 12px rgba(100, 108, 255, 0.1);
  }
  
  .space-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  
  .space-header h4 {
    margin: 0;
    text-transform: capitalize;
  }
  
  .status-badge {
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.875rem;
    font-weight: 500;
    color: white;
  }
  
  .space-info {
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }
  
  .space-info p {
    margin: 0.5rem 0;
    color: #888;
  }
  
  .space-info strong {
    color: #ccc;
  }
  
  .space-info a {
    color: #646cff;
    text-decoration: none;
  }
  
  .space-info a:hover {
    text-decoration: underline;
  }
  
  .space-actions {
    display: flex;
    gap: 0.5rem;
  }
  
  .action-btn {
    flex: 1;
    padding: 0.5rem;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.3s;
    text-decoration: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .action-btn.start {
    background: #22c55e;
    color: white;
  }
  
  .action-btn.start:hover:not(:disabled) {
    background: #16a34a;
  }
  
  .action-btn.stop {
    background: #ef4444;
    color: white;
  }
  
  .action-btn.stop:hover:not(:disabled) {
    background: #dc2626;
  }
  
  .action-btn.open {
    background: #646cff;
    color: white;
  }
  
  .action-btn.open:hover {
    background: #535bf2;
  }
  
  .action-btn.refresh {
    background: transparent;
    border: 1px solid #646cff;
    color: #646cff;
    flex: 0 0 auto;
    min-width: 40px;
  }
  
  .action-btn.refresh:hover:not(:disabled) {
    background: rgba(100, 108, 255, 0.1);
  }
</style>
