<script>
  import { onMount } from 'svelte';
  import { API_BASE } from '../config.js';

  let roles = [];
  let invites = [];
  let loading = true;
  let loadError = '';
  let email = '';
  let roleId = null;
  let busy = '';
  let message = '';
  let error = '';

  async function api(path, body = {}) {
    const response = await fetch(`${API_BASE}/admin/role-invites${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Something went wrong.');
    return data;
  }

  async function load() {
    try {
      const { data } = await api('');
      roles = data.roles;
      invites = data.invites;
      if (roleId === null && roles.length) roleId = roles[0].id;
      loadError = '';
    } catch (err) {
      loadError = err.message;
    } finally {
      loading = false;
    }
  }

  async function set(targetEmail, targetRoleId, granted, key) {
    busy = key;
    message = '';
    error = '';
    try {
      const result = await api('/set', { email: targetEmail, roleId: targetRoleId, granted });
      invites = result.data.invites;
      message = result.message;
      if (key === 'give' || key === 'remove') email = '';
    } catch (err) {
      error = err.message;
    } finally {
      busy = '';
    }
  }

  $: validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  onMount(load);
</script>

<div class="give">
  <h2>Give roles</h2>
  {#if loading}
    <p class="note">Loading...</p>
  {:else if loadError}
    <p class="result error">{loadError}</p>
  {:else if !roles.length}
    <p class="note">There are no roles you can give right now.</p>
  {:else}
    <p class="note">Works whether or not they've logged in to Spaces before. If nobody uses the email yet, they get the role the first time they log in with it.</p>
    <form class="row" on:submit|preventDefault={() => set(email.trim(), roleId, true, 'give')}>
      <input type="email" bind:value={email} placeholder="their@email.com" aria-label="Email" autocomplete="off" />
      <select bind:value={roleId} aria-label="Role">
        {#each roles as role (role.id)}
          <option value={role.id}>{role.name}</option>
        {/each}
      </select>
      <button class="btn primary" type="submit" disabled={busy !== '' || !validEmail}>
        {busy === 'give' ? 'Giving...' : 'Give'}
      </button>
      <button class="btn" type="button" disabled={busy !== '' || !validEmail} on:click={() => set(email.trim(), roleId, false, 'remove')}>
        {busy === 'remove' ? 'Removing...' : 'Remove'}
      </button>
    </form>
    {#if message}<p class="result">{message}</p>{/if}
    {#if error}<p class="result error">{error}</p>{/if}

    <h3>Waiting for their first login</h3>
    {#if invites.length}
      <ul class="people">
        {#each invites as invite (invite.id)}
          <li>
            <span>
              {invite.email}
              <span class="meta">{invite.role_name}{invite.granted_by ? ` · from ${invite.granted_by}` : ''} · {new Date(invite.created_at).toLocaleDateString()}</span>
            </span>
            <button class="btn" disabled={busy !== ''} on:click={() => set(invite.email, invite.role_id, false, `invite-${invite.id}`)}>
              {busy === `invite-${invite.id}` ? 'Removing...' : 'Remove'}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="note">Nobody is waiting.</p>
    {/if}
  {/if}
</div>

<style>
  .give {
    max-width: 640px;
  }

  h2 {
    margin: 0 0 6px 0;
    font-size: 18px;
  }

  h3 {
    margin: 24px 0 8px 0;
    font-size: 14px;
    color: #666;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  input[type="email"] {
    flex: 1 1 220px;
    min-width: 0;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
  }

  select {
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    background: #fff;
    color: #222;
  }

  .btn {
    padding: 6px 12px;
    background: #fff;
    color: #222;
    border: 1px solid #ccc;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .btn.primary {
    background: #007bff;
    border-color: #007bff;
    color: #fff;
  }

  .people {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }

  .people li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    padding: 8px 0;
    border-bottom: 1px solid #eee;
    word-break: break-all;
  }

  .meta {
    display: block;
    font-size: 12px;
    color: #666;
  }

  .note {
    font-size: 13px;
    color: #666;
    margin: 4px 0;
  }

  .result {
    margin: 12px 0 0 0;
    font-size: 13px;
    color: #1e7e34;
  }

  .result.error {
    color: #c82333;
  }
</style>
