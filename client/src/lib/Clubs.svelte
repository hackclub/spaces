<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { API_BASE } from '../config.js';

  export let authorization = '';
  export let user = null;

  const dispatch = createEventDispatcher();

  let clubData = null;
  let ships = [];
  let sharedSpaces = [];
  let loading = true;
  let linkLoading = false;
  let shipsLoading = false;
  let sharedLoading = false;
  let error = '';
  let message = '';
  let activeTab = 'info';

  onMount(() => {
    loadClubData();
  });

  async function loadClubData() {
    loading = true;
    error = '';

    try {
      const response = await fetch(`${API_BASE}/clubs/me`, {
        headers: {
          'Authorization': authorization
        }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        clubData = data.data.club;
        if (clubData) {
          loadShips();
          if (clubData.role === 'leader') {
            loadSharedSpaces();
          }
        }
      } else {
        error = data.message || 'Failed to load club data';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
    } finally {
      loading = false;
    }
  }

  async function loadShips() {
    shipsLoading = true;

    try {
      const response = await fetch(`${API_BASE}/clubs/me/ships`, {
        headers: {
          'Authorization': authorization
        }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        ships = data.data.ships || [];
      }
    } catch (err) {
      console.error('Failed to load ships:', err);
    } finally {
      shipsLoading = false;
    }
  }

  async function loadSharedSpaces() {
    sharedLoading = true;

    try {
      const response = await fetch(`${API_BASE}/spaces/shared-with-me`, {
        headers: {
          'Authorization': authorization
        }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        sharedSpaces = data.data.spaces || [];
      }
    } catch (err) {
      console.error('Failed to load shared spaces:', err);
    } finally {
      sharedLoading = false;
    }
  }

  async function linkClub() {
    linkLoading = true;
    error = '';
    message = '';

    try {
      const response = await fetch(`${API_BASE}/clubs/link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization
        }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        message = 'Successfully linked to your club!';
        await loadClubData();
      } else {
        error = data.message || 'Failed to link club';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
    } finally {
      linkLoading = false;
    }
  }

  async function unlinkClub() {
    if (!confirm('Are you sure you want to unlink from your club?')) {
      return;
    }

    linkLoading = true;
    error = '';
    message = '';

    try {
      const response = await fetch(`${API_BASE}/clubs/unlink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization
        }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        message = 'Successfully unlinked from club';
        clubData = null;
        ships = [];
        sharedSpaces = [];
      } else {
        error = data.message || 'Failed to unlink club';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
    } finally {
      linkLoading = false;
    }
  }

  function getRoleBadgeClass(role) {
    return role === 'leader' ? 'role-leader' : 'role-member';
  }

  function formatDate(dateString) {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleDateString();
  }
</script>

<div class="clubs-container">
  <h2>My Club</h2>

  {#if loading}
    <div class="loading">Loading club information...</div>
  {:else if !clubData}
    <div class="no-club">
      <div class="no-club-icon">🏫</div>
      <h3>No Club Linked</h3>
      <p>Link your Hack Club to see your club information and share spaces with your club leaders.</p>
      <p class="info-text">Link using your registered email as a club leader or member.</p>
      
      {#if error}
        <div class="error">{error}</div>
      {/if}
      {#if message}
        <div class="success">{message}</div>
      {/if}
      
      <button class="btn-primary" on:click={linkClub} disabled={linkLoading}>
        {linkLoading ? 'Linking...' : 'Link My Club'}
      </button>
    </div>
  {:else}
    <div class="club-tabs">
      <button 
        class="tab-btn" 
        class:active={activeTab === 'info'}
        on:click={() => activeTab = 'info'}
      >
        Club Info
      </button>
      <button 
        class="tab-btn" 
        class:active={activeTab === 'ships'}
        on:click={() => activeTab = 'ships'}
      >
        Ships ({ships.length})
      </button>
      {#if clubData.role === 'leader'}
        <button 
          class="tab-btn" 
          class:active={activeTab === 'shared'}
          on:click={() => activeTab = 'shared'}
        >
          Shared Spaces ({sharedSpaces.length})
        </button>
      {/if}
    </div>

    {#if error}
      <div class="error">{error}</div>
    {/if}
    {#if message}
      <div class="success">{message}</div>
    {/if}

    {#if activeTab === 'info'}
      <div class="club-info-card">
        <div class="club-header">
          <h3>{clubData.displayName || clubData.name}</h3>
          <span class="role-badge {getRoleBadgeClass(clubData.role)}">
            {clubData.role}
          </span>
        </div>

        <div class="club-details">
          {#if clubData.country}
            <div class="detail-row">
              <span class="label">Country:</span>
              <span class="value">{clubData.country}</span>
            </div>
          {/if}
          
          {#if clubData.metadata}
            {#if clubData.metadata.status}
              <div class="detail-row">
                <span class="label">Status:</span>
                <span class="value status-badge">{clubData.metadata.status}</span>
              </div>
            {/if}
            {#if clubData.metadata.level}
              <div class="detail-row">
                <span class="label">Level:</span>
                <span class="value">{clubData.metadata.level}</span>
              </div>
            {/if}
            {#if clubData.metadata.attendees}
              <div class="detail-row">
                <span class="label">Est. Attendees:</span>
                <span class="value">{clubData.metadata.attendees}</span>
              </div>
            {/if}
            {#if clubData.metadata.meetingDays}
              <div class="detail-row">
                <span class="label">Meeting Days:</span>
                <span class="value">{clubData.metadata.meetingDays}</span>
              </div>
            {/if}
          {/if}

          <div class="detail-row">
            <span class="label">Last Verified:</span>
            <span class="value">{formatDate(clubData.lastVerifiedAt)}</span>
          </div>
        </div>

        <div class="club-actions">
          <button class="btn-secondary" on:click={loadClubData} disabled={loading}>
            Refresh
          </button>
          <button class="btn-danger" on:click={unlinkClub} disabled={linkLoading}>
            {linkLoading ? 'Unlinking...' : 'Unlink Club'}
          </button>
        </div>
      </div>
    {:else if activeTab === 'ships'}
      <div class="ships-section">
        {#if shipsLoading}
          <div class="loading">Loading ships...</div>
        {:else if ships.length === 0}
          <div class="empty-state">
            <p>No ships found for your club yet.</p>
          </div>
        {:else}
          <div class="ships-grid">
            {#each ships as ship}
              <div class="ship-card">
                <div class="ship-name">{ship.workshop || 'Unnamed Ship'}</div>
                {#if ship.rating}
                  <div class="ship-rating">⭐ {ship.rating}</div>
                {/if}
                {#if ship.codeUrl}
                  <a href={ship.codeUrl} target="_blank" rel="noopener noreferrer" class="ship-link">
                    View Code →
                  </a>
                {/if}
                {#if ship.ysws && ship.ysws.length > 0}
                  <div class="ship-ysws">
                    {#each ship.ysws as ysws}
                      <span class="ysws-badge">{ysws}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {:else if activeTab === 'shared'}
      <div class="shared-section">
        {#if sharedLoading}
          <div class="loading">Loading shared spaces...</div>
        {:else if sharedSpaces.length === 0}
          <div class="empty-state">
            <p>No spaces have been shared with you yet.</p>
            <p class="hint">Club members can share their spaces with you from the Dashboard.</p>
          </div>
        {:else}
          <div class="shared-spaces-grid">
            {#each sharedSpaces as space}
              <div class="shared-space-card">
                <div class="space-header">
                  <span class="space-type">{space.type}</span>
                  <span class="space-status" class:running={space.running}>
                    {space.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
                <div class="space-owner">
                  Shared by: <strong>{space.owner.username}</strong>
                </div>
                <div class="space-meta">
                  <span>Shared: {formatDate(space.sharedAt)}</span>
                </div>
                {#if space.running && space.accessUrl}
                  <a href={space.accessUrl} target="_blank" rel="noopener noreferrer" class="btn-primary space-open-btn">
                    Open Space
                  </a>
                {:else}
                  <div class="space-stopped-hint">Space must be running to access</div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .clubs-container {
    max-width: 900px;
    margin: 0 auto;
    padding: 20px;
  }

  h2 {
    margin-bottom: 20px;
    color: var(--text);
  }

  .loading {
    text-align: center;
    padding: 40px;
    color: var(--muted);
  }

  .no-club {
    text-align: center;
    padding: 60px 20px;
    background: var(--snow);
    border-radius: 12px;
    border: 1px solid var(--smoke);
  }

  .no-club-icon {
    font-size: 64px;
    margin-bottom: 20px;
  }

  .no-club h3 {
    margin-bottom: 10px;
    color: var(--text);
  }

  .no-club p {
    color: var(--muted);
    margin-bottom: 10px;
  }

  .info-text {
    font-size: 14px;
    font-style: italic;
  }

  .club-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 20px;
    background: var(--snow);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--smoke);
  }

  .tab-btn {
    flex: 1;
    padding: 10px 16px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s;
  }

  .tab-btn:hover {
    background: var(--smoke);
    color: var(--text);
  }

  .tab-btn.active {
    background: var(--blue);
    color: var(--white);
  }

  .club-info-card {
    background: var(--snow);
    border: 1px solid var(--smoke);
    border-radius: 12px;
    padding: 24px;
  }

  .club-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--smoke);
  }

  .club-header h3 {
    margin: 0;
    color: var(--text);
    font-size: 24px;
  }

  .role-badge {
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .role-leader {
    background: rgba(51, 214, 166, 0.15);
    color: var(--green);
  }

  .role-member {
    background: rgba(90, 95, 255, 0.15);
    color: var(--blue);
  }

  .club-details {
    display: grid;
    gap: 12px;
    margin-bottom: 24px;
  }

  .detail-row {
    display: flex;
    gap: 12px;
  }

  .detail-row .label {
    font-weight: 500;
    color: var(--text);
    min-width: 120px;
  }

  .detail-row .value {
    color: var(--muted);
  }

  .status-badge {
    padding: 2px 8px;
    background: rgba(246, 173, 85, 0.15);
    color: var(--orange);
    border-radius: 4px;
    font-size: 12px;
  }

  .club-actions {
    display: flex;
    gap: 12px;
  }

  .btn-primary {
    background: var(--blue);
    color: var(--white);
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: background 0.2s;
  }

  .btn-primary:hover {
    background: var(--cyan);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--slate);
    color: var(--white);
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.2s;
  }

  .btn-secondary:hover {
    background: var(--muted);
  }

  .btn-danger {
    background: transparent;
    color: var(--red);
    border: 1px solid var(--red);
    padding: 10px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .btn-danger:hover {
    background: rgba(236, 55, 80, 0.1);
  }

  .error {
    color: var(--red);
    margin-bottom: 15px;
    padding: 10px;
    background: rgba(236, 55, 80, 0.1);
    border-radius: 4px;
  }

  .success {
    color: var(--green);
    margin-bottom: 15px;
    padding: 10px;
    background: rgba(51, 214, 166, 0.1);
    border-radius: 4px;
  }

  .ships-section, .shared-section {
    background: var(--snow);
    border: 1px solid var(--smoke);
    border-radius: 12px;
    padding: 24px;
  }

  .empty-state {
    text-align: center;
    padding: 40px;
    color: var(--muted);
  }

  .empty-state .hint {
    font-size: 14px;
    font-style: italic;
  }

  .ships-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .ship-card {
    background: var(--white);
    border: 1px solid var(--smoke);
    border-radius: 8px;
    padding: 16px;
  }

  .ship-name {
    font-weight: 600;
    color: var(--text);
    margin-bottom: 8px;
  }

  .ship-rating {
    color: var(--orange);
    font-size: 14px;
    margin-bottom: 8px;
  }

  .ship-link {
    color: var(--blue);
    text-decoration: none;
    font-size: 14px;
  }

  .ship-link:hover {
    text-decoration: underline;
  }

  .ship-ysws {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ysws-badge {
    background: rgba(90, 95, 255, 0.1);
    color: var(--blue);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
  }

  .shared-spaces-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .shared-space-card {
    background: var(--white);
    border: 1px solid var(--smoke);
    border-radius: 8px;
    padding: 16px;
  }

  .space-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .space-type {
    font-weight: 600;
    color: var(--text);
  }

  .space-status {
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    background: rgba(156, 163, 175, 0.2);
    color: var(--muted);
  }

  .space-status.running {
    background: rgba(51, 214, 166, 0.15);
    color: var(--green);
  }

  .space-owner {
    color: var(--muted);
    font-size: 14px;
    margin-bottom: 8px;
  }

  .space-owner strong {
    color: var(--text);
  }

  .space-meta {
    color: var(--muted);
    font-size: 12px;
    margin-bottom: 12px;
  }

  .space-open-btn {
    display: block;
    text-align: center;
    text-decoration: none;
    width: 100%;
    box-sizing: border-box;
  }

  .space-stopped-hint {
    text-align: center;
    color: var(--muted);
    font-size: 13px;
    padding: 8px;
    background: var(--snow);
    border-radius: 4px;
  }
</style>
