<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { API_BASE, ERROR_MESSAGES } from '../config.js';
  import '../styles/dashboard.css';
  import { currentTheme } from '../stores/theme.js';
  import { themes } from '../themes.js';
  import FlagIcon from '../assets/flag.svg?raw';
  import ShareWithClubToggle from './ShareWithClubToggle.svelte';

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
  let actionError = {};
  let dropdownOpen = false;
  let showPassword = false;
  let clubData = null;
  let spaceShareStatus = {};

  onMount(() => {
    loadClubData();
  });

  async function loadClubData() {
    try {
      const response = await fetch(`${API_BASE}/clubs/me`, {
        headers: {
          'Authorization': authorization
        }
      });
      const data = await response.json();
      if (response.ok && data.success && data.data.club) {
        clubData = data.data.club;
        loadSpaceShareStatuses();
      }
    } catch (err) {
      console.error('Failed to load club data:', err);
    }
  }

  async function loadSpaceShareStatuses() {
    for (const space of spaces) {
      try {
        const response = await fetch(`${API_BASE}/spaces/${space.id}/share/status`, {
          headers: {
            'Authorization': authorization
          }
        });
        const data = await response.json();
        if (response.ok && data.success) {
          spaceShareStatus[space.id] = data.data;
          spaceShareStatus = spaceShareStatus;
        }
      } catch (err) {
        console.error('Failed to load share status:', err);
      }
    }
  }

  const spaceTypes = [
    { value: 'code-server', label: 'VS Code Server', description: 'Web-based code editor' },
    { value: 'blender', label: 'Blender 3D', description: '3D modeling and animation' },
    { value: 'kicad', label: 'KiCad', description: 'PCB design software' }
  ];

  async function createSpace() {
    error = '';
    loading = true;

    try {
      const body = { type: newSpaceType };
      if (newSpaceType !== 'kicad' && newSpaceType !== 'blender') {
        body.password = newSpacePassword;
      }

      const response = await fetch(`${API_BASE}/spaces/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        showCreateForm = false;
        newSpacePassword = '';
        await loadSpaces();
      } else {
        if (response.status === 403 && data.error?.includes('Maximum space limit')) {
          error = data.error;
        } else {
          error = data.error || ERROR_MESSAGES.CREATE_FAILED;
        }
      }
    } catch (err) {
      error = ERROR_MESSAGES.NETWORK_ERROR;
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
    actionError[spaceId] = '';
    actionLoading = actionLoading;
    actionError = actionError;

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
        if (data.error?.includes('only have one space running')) {
          actionError[spaceId] = data.error;
        } else {
          actionError[spaceId] = data.error || ERROR_MESSAGES.START_FAILED;
        }
        actionError = actionError;
      }
    } catch (err) {
      actionError[spaceId] = ERROR_MESSAGES.NETWORK_ERROR;
      actionError = actionError;
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }

  async function stopSpace(spaceId) {
    actionLoading[spaceId] = 'stopping';
    actionError[spaceId] = '';
    actionLoading = actionLoading;
    actionError = actionError;

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
        actionError[spaceId] = data.error || ERROR_MESSAGES.STOP_FAILED;
        actionError = actionError;
      }
    } catch (err) {
      actionError[spaceId] = ERROR_MESSAGES.NETWORK_ERROR;
      actionError = actionError;
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }

  async function refreshStatus(spaceId) {
    actionLoading[spaceId] = 'refreshing';
    actionError[spaceId] = '';
    actionLoading = actionLoading;
    actionError = actionError;

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
        actionError[spaceId] = data.error || ERROR_MESSAGES.STATUS_FAILED;
        actionError = actionError;
      }
    } catch (err) {
      actionError[spaceId] = ERROR_MESSAGES.NETWORK_ERROR;
      actionError = actionError;
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }

  async function deleteSpace(spaceId) {
    if (!confirm('Are you sure you want to delete this space? This action cannot be undone.')) {
      return;
    }

    actionLoading[spaceId] = 'deleting';
    actionError[spaceId] = '';
    actionLoading = actionLoading;
    actionError = actionError;

    try {
      const response = await fetch(`${API_BASE}/spaces/delete/${spaceId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': authorization,
        },
      });

      const data = await response.json();

      if (response.ok) {
        await loadSpaces();
      } else {
        actionError[spaceId] = data.error || 'Failed to delete space';
        actionError = actionError;
      }
    } catch (err) {
      actionError[spaceId] = ERROR_MESSAGES.NETWORK_ERROR;
      actionError = actionError;
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }

  function handleSignOut() {
    dispatch('signout');
  }

  function getStatusClass(status) {
    switch(status?.toLowerCase()) {
      case 'running': return 'status-running';
      case 'stopped': return 'status-stopped';
      case 'created': return 'status-created';
      default: return 'status-unknown';
    }
  }

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
  }

  function selectSpaceType(value) {
    newSpaceType = value;
    dropdownOpen = false;
  }

  $: selectedType = spaceTypes.find(type => type.value === newSpaceType) || spaceTypes[0];

  $: logoColor = (() => {
    const theme = themes[$currentTheme];
    if (theme && theme.colors['--red']) {
      return theme.colors['--red'];
    }
    return '#ec3750';
  })();

  function togglePasswordVisibility() {
    showPassword = !showPassword;
  }

  function handleSettings() {
    dispatch('settings');
  }

  function handleClubs() {
    dispatch('clubs');
  }

  function handleSwitchToPlayground() {
    dispatch('switchview', { view: 'playground' });
  }
</script>

<div class="dashboard">
  <header class="dashboard-header">
    <div class="header-content">
      <div class="dashboard-logo" style="color: {logoColor}">
        {@html FlagIcon}
      </div>
      <div>
        <h1 class="dashboard-title">Hack Club Spaces</h1>
        <p class="welcome-text">Welcome, {username}!</p>
      </div>
    </div>
    <div class="header-actions">
      <div class="view-switcher">
        <button class="view-tab active">Spaces</button>
        <button class="view-tab" on:click={handleSwitchToPlayground}>Playground</button>
      </div>
      <button class="clubs-button" on:click={handleClubs}>My Club</button>
      <button class="settings-button" on:click={handleSettings}>Settings</button>
      <button class="signout-button" on:click={handleSignOut}>Sign Out</button>
    </div>
  </header>

  <div class="dashboard-content">
    <div class="actions-bar">
      <button class="btn-primary" on:click={() => showCreateForm = !showCreateForm}>
        {showCreateForm ? 'Cancel' : '+ Create New Space'}
      </button>
      <button class="btn-secondary" on:click={loadSpaces}>
        Refresh
      </button>
    </div>

    {#if showCreateForm}
      <div class="create-form">
        <h3 class="create-form-title">Create New Space</h3>

        <div class="form-group">
          <label class="form-label" for="type">Space Type</label>
          <div class="custom-select">
            <button
              type="button"
              class="select-trigger"
              class:open={dropdownOpen}
              on:click={toggleDropdown}
            >
              {selectedType.label}
            </button>
            <div class="select-arrow" class:open={dropdownOpen}></div>
            <div class="select-dropdown" class:open={dropdownOpen}>
              {#each spaceTypes as spaceType}
                <div
                  class="select-option"
                  class:selected={spaceType.value === newSpaceType}
                  on:click={() => selectSpaceType(spaceType.value)}
                  on:keypress={(e) => e.key === 'Enter' && selectSpaceType(spaceType.value)}
                  role="option"
                  tabindex="0"
                  aria-selected={spaceType.value === newSpaceType}
                >
                  <div class="option-label">{spaceType.label}</div>
                  <div class="option-description">{spaceType.description}</div>
                </div>
              {/each}
            </div>
          </div>
        </div>

        {#if newSpaceType !== 'kicad' && newSpaceType !== 'blender'}
          <div class="form-group">
            <label class="form-label" for="password">Password (min. 8 characters)</label>
            <p class="password-info">This password will be needed to access the space. Please pick a secure password, you cannot change it later.</p>
            <div class="password-input-wrapper">
              {#if showPassword}
                <input
                  class="form-input password-input"
                  id="password"
                  type="text"
                  bind:value={newSpacePassword}
                  required
                  placeholder="Set a password for this space"
                />
              {:else}
                <input
                  class="form-input password-input"
                  id="password"
                  type="password"
                  bind:value={newSpacePassword}
                  required
                  placeholder="Set a password for this space"
                />
              {/if}
              <button
                type="button"
                class="password-toggle"
                on:click={togglePasswordVisibility}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {#if showPassword}
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256">
                    <path d="M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79A134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z"></path>
                  </svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256">
                    <path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"></path>
                  </svg>
                {/if}
              </button>
            </div>
          </div>
        {:else}
          <div class="form-group">
          </div>
        {/if}

        {#if error}
          <div class="error-message">{error}</div>
        {/if}

        <button
          class="btn-primary"
          on:click={createSpace}
          disabled={loading || (newSpaceType !== 'kicad' && newSpaceType !== 'blender' && (!newSpacePassword || newSpacePassword.length < 8))}
        >
          {loading ? 'Creating...' : 'Create Space'}
        </button>
      </div>
    {/if}

    <div class="spaces-list">
      <h3 class="section-title">Your Spaces</h3>

      {#if spaces.length === 0}
        <div class="empty-state">
          <p>No spaces yet. Create your first space to get started!</p>
        </div>
      {:else}
        <div class="spaces-grid">
          {#each spaces as space}
            <div class="space-card">
              <div class="space-header">
                <h4 class="space-type">{space.type}</h4>
                <span class="status-badge {getStatusClass(space.status)}">
                  {space.status || 'Unknown'}
                </span>
              </div>

              <div class="space-info">
                <p><strong>Space ID:</strong> {space.id}</p>
                <p><strong>Created:</strong> {new Date(space.created_at).toLocaleString()}</p>
              </div>

              <div class="space-share-section">
                <ShareWithClubToggle 
                  spaceId={space.id}
                  {authorization}
                  hasClub={!!clubData}
                  initialShared={spaceShareStatus[space.id]?.shared || false}
                  clubName={clubData?.displayName || clubData?.name || ''}
                />
              </div>

              {#if actionError[space.id]}
                <div class="error-message small">{actionError[space.id]}</div>
              {/if}

              <div class="space-actions">
                {#if actionLoading[space.id]}
                  <button disabled class="action-btn">
                    {actionLoading[space.id]}...
                  </button>
                {:else}
                  {#if space.running || space.status?.toLowerCase() === 'running'}
                    {#if space.access_url}
                      <a
                        href={space.access_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="action-btn open"
                      >
                        Open
                      </a>
                    {/if}
                    <button
                      class="action-btn stop"
                      on:click={() => stopSpace(space.id)}
                    >
                      Stop
                    </button>
                  {:else}
                    <button
                      class="action-btn start"
                      on:click={() => startSpace(space.id)}
                    >
                      Start
                    </button>
                  {/if}
                  <button
                    class="action-btn refresh"
                    on:click={() => refreshStatus(space.id)}
                  >
                    ↻
                  </button>
                  <button
                    class="action-btn delete"
                    on:click={() => deleteSpace(space.id)}
                  >
                    Delete
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
