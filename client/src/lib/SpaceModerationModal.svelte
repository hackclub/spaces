<script>
  import { createEventDispatcher } from 'svelte';
  import { API_BASE } from '../config.js';

  export let space;

  const dispatch = createEventDispatcher();

  let lockReason = '';
  let unlockNote = '';
  let busy = '';
  let message = '';
  let error = '';

  async function moderate(name, path, body = {}) {
    busy = name;
    message = '';
    error = '';
    try {
      const response = await fetch(`${API_BASE}/admin/moderation/spaces/${space.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        error = data.message || 'Something went wrong.';
        return null;
      }
      message = data.message || 'Done.';
      return data;
    } catch (err) {
      error = 'Network error. Please try again.';
      return null;
    } finally {
      busy = '';
    }
  }

  async function lock() {
    if (!lockReason.trim()) {
      error = 'Give a reason. The owner sees it on their dashboard.';
      return;
    }
    if (!confirm(`Lock space #${space.id}? It stops now, its password changes, and the owner can't start or delete it until it's unlocked.`)) return;
    if (await moderate('lock', 'lock', { reason: lockReason.trim() })) {
      space = { ...space, running: false, locked_at: new Date().toISOString(), locked_reason: lockReason.trim() };
      lockReason = '';
      dispatch('changed');
    }
  }

  async function unlock() {
    if (!confirm(`Unlock space #${space.id}? The owner gets it back.`)) return;
    if (await moderate('unlock', 'unlock', { reason: unlockNote.trim() || null })) {
      space = { ...space, locked_at: null, locked_reason: null };
      unlockNote = '';
      dispatch('changed');
    }
  }

  function close() {
    dispatch('close');
  }
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && close()} />

<div class="overlay" role="presentation" on:click|self={close}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Moderate space {space.id}">
    <div class="modal-header">
      <div>
        <h2>{space.name ?? space.type} <span class="muted">#{space.id}</span></h2>
        <p class="sub">{space.type} · {space.username} ({space.email})</p>
      </div>
      <button class="close-btn" on:click={close} aria-label="Close">×</button>
    </div>

    <div class="badges">
      {#if space.locked_at}
        <span class="badge locked">Locked</span>
      {:else}
        <span class="badge">{space.running ? 'Running' : 'Stopped'}</span>
      {/if}
      <span class="badge">Sandbox {space.container_id ?? '—'}</span>
    </div>
    <p class="note">Only superadmins can see this. Everything here is written to the admin log, and owners aren't told.</p>

    <section>
      <h3>Lock</h3>
      {#if space.locked_at}
        <p class="note">Locked {new Date(space.locked_at).toLocaleString()}{space.locked_reason ? `: ${space.locked_reason}` : ''}</p>
        <div class="row">
          <input type="text" placeholder="Note for the log (optional)" bind:value={unlockNote} maxlength="1000" />
          <button class="btn" disabled={busy !== ''} on:click={unlock}>{busy === 'unlock' ? 'Unlocking...' : 'Unlock'}</button>
        </div>
      {:else}
        <p class="note">Stops the space and changes its password. The owner can't start, delete or change it, and sees this reason on their dashboard.</p>
        <div class="row">
          <input type="text" placeholder="Reason (the owner sees this)" bind:value={lockReason} maxlength="1000" />
          <button class="lock-btn" disabled={busy !== ''} on:click={lock}>{busy === 'lock' ? 'Locking...' : 'Lock space'}</button>
        </div>
      {/if}
    </section>

    {#if message}<p class="result">{message}</p>{/if}
    {#if error}<p class="result error">{error}</p>{/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 1000;
  }

  .modal {
    background: #fff;
    color: #222;
    border-radius: 8px;
    padding: 20px;
    width: 100%;
    max-width: 720px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 20px;
  }

  h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: #666;
  }

  .muted {
    color: #888;
    font-weight: normal;
  }

  .sub {
    margin: 4px 0 0 0;
    font-size: 13px;
    color: #666;
    word-break: break-all;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    color: #666;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 14px 0 4px;
  }

  .badge {
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 4px;
    background: #f0f0f0;
  }

  .badge.locked {
    background: #e67e22;
    color: #fff;
  }

  section {
    margin-top: 18px;
    border-top: 1px solid #eee;
    padding-top: 14px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  input[type="text"] {
    flex: 1;
    min-width: 200px;
    padding: 6px 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  .btn {
    padding: 6px 12px;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: #f5f5f5;
  }

  .lock-btn {
    padding: 6px 12px;
    background: #e67e22;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn:disabled,
  .lock-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .note {
    font-size: 13px;
    color: #666;
    margin: 8px 0;
  }

  .result {
    margin: 16px 0 0 0;
    font-size: 13px;
    color: #1e7e34;
  }

  .result.error {
    color: #c82333;
  }
</style>
