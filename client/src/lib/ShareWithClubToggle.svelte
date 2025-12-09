<script>
  import { API_BASE } from '../config.js';

  export let spaceId;
  export let authorization;
  export let hasClub = false;
  export let initialShared = false;
  export let clubName = '';

  let shared = initialShared;
  let loading = false;
  let error = '';

  async function toggleShare() {
    if (!hasClub) return;
    
    loading = true;
    error = '';
    const newShareState = !shared;

    try {
      const response = await fetch(`${API_BASE}/spaces/${spaceId}/share/club`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization
        },
        body: JSON.stringify({ share: newShareState })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        shared = newShareState;
        if (data.data?.clubName) {
          clubName = data.data.clubName;
        }
      } else {
        error = data.message || 'Failed to update sharing';
      }
    } catch (err) {
      error = 'Network error';
      console.error(err);
    } finally {
      loading = false;
    }
  }
</script>

{#if hasClub}
  <div class="share-toggle-container">
    <button 
      class="share-toggle" 
      class:shared={shared}
      class:loading={loading}
      on:click={toggleShare}
      disabled={loading}
      title={shared ? `Shared with ${clubName || 'your club'} leaders` : 'Share with club leaders'}
    >
      {#if loading}
        <span class="spinner"></span>
      {:else if shared}
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256">
          <path d="M230.91,172A8,8,0,0,1,228,182.91l-96,56a8,8,0,0,1-8.06,0l-96-56A8,8,0,0,1,36,169.09l92,53.65,92-53.65A8,8,0,0,1,230.91,172ZM220,121.09l-92,53.65L36,121.09A8,8,0,0,0,28,134.91l96,56a8,8,0,0,0,8.06,0l96-56A8,8,0,1,0,220,121.09ZM24,80a8,8,0,0,1,4-6.91l96-56a8,8,0,0,1,8.06,0l96,56a8,8,0,0,1,0,13.82l-96,56a8,8,0,0,1-8.06,0l-96-56A8,8,0,0,1,24,80Zm23.88,0L128,126.74,208.12,80,128,33.26Z"></path>
        </svg>
        Shared
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256">
          <path d="M229.66,109.66l-48,48a8,8,0,0,1-11.32-11.32L204.69,112H165a88,88,0,0,0-85.23,66,8,8,0,0,1-15.5-4A103.94,103.94,0,0,1,165,96h39.71L170.34,61.66a8,8,0,0,1,11.32-11.32l48,48A8,8,0,0,1,229.66,109.66ZM192,208H40V88a8,8,0,0,0-16,0V208a16,16,0,0,0,16,16H192a8,8,0,0,0,0-16Z"></path>
        </svg>
        Share
      {/if}
    </button>
    {#if error}
      <span class="share-error" title={error}>⚠</span>
    {/if}
  </div>
{/if}

<style>
  .share-toggle-container {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .share-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--smoke);
    background: var(--white);
    color: var(--muted);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.2s;
  }

  .share-toggle:hover {
    border-color: var(--blue);
    color: var(--blue);
  }

  .share-toggle.shared {
    background: rgba(51, 214, 166, 0.1);
    border-color: var(--green);
    color: var(--green);
  }

  .share-toggle.loading {
    opacity: 0.6;
    cursor: wait;
  }

  .share-toggle:disabled {
    cursor: not-allowed;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .share-error {
    color: var(--red);
    cursor: help;
  }
</style>
