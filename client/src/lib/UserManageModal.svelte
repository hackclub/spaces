<script>
  import { createEventDispatcher } from 'svelte';
  import { API_BASE } from '../config.js';

  export let user;
  export let me;

  const dispatch = createEventDispatcher();

  let maxSpaces = user.max_spaces;
  let maxRunning = user.max_running;
  let busy = '';
  let message = '';
  let error = '';

  $: isSelf = me?.email === user.email;
  $: isStaff = user.is_admin || user.is_superadmin;
  $: canManage = me?.is_superadmin || !isStaff;

  async function act(name, path, body = {}, confirmText = null) {
    if (confirmText && !confirm(confirmText)) return;
    busy = name;
    message = '';
    error = '';
    try {
      const response = await fetch(`${API_BASE}/admin/users/${user.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        error = data.message || 'Something went wrong.';
        return;
      }
      message = data.message || 'Saved.';
      if (data.data) user = { ...user, ...data.data };
      dispatch('changed');
      if (path === 'delete') dispatch('close');
    } catch (err) {
      error = 'Network error. Please try again.';
    } finally {
      busy = '';
    }
  }

  function close() {
    dispatch('close');
  }
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && close()} />

<div class="overlay" role="presentation" on:click|self={close}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Manage {user.username}">
    <div class="modal-header">
      <div>
        <h2>{user.username}</h2>
        <p class="sub">{user.email} · ID {user.id}</p>
      </div>
      <button class="close-btn" on:click={close} aria-label="Close">×</button>
    </div>

    <div class="badges">
      {#if user.is_superadmin}<span class="badge strong">Superadmin</span>{:else if user.is_admin}<span class="badge strong">Admin</span>{/if}
      {#if user.club_leader}<span class="badge">Club leader</span>{:else if user.in_club}<span class="badge">Club member</span>{/if}
      <span class="badge">{user.hackclub_linked ? `Hack Club: ${user.hackclub_verification_status || 'linked'}` : 'No Hack Club account'}</span>
      {#if user.has_password}<span class="badge">Club password login</span>{/if}
      {#if user.beta_access}<span class="badge">Beta tester</span>{/if}
      <span class="badge">{user.spaceCount} space{user.spaceCount === 1 ? '' : 's'}{user.runningCount ? `, ${user.runningCount} running` : ''}</span>
    </div>

    {#if !canManage}
      <p class="note">Only superadmins can manage admins and superadmins.</p>
    {:else}
      <section>
        <h3>Limits</h3>
        <div class="row bottom">
          <label class="limit">
            Spaces they can have
            <input type="number" min="0" max="100" bind:value={maxSpaces} />
          </label>
          <label class="limit">
            Running at once
            <input type="number" min="0" max="10" bind:value={maxRunning} />
          </label>
          <button class="btn" disabled={busy !== '' || (maxSpaces === user.max_spaces && maxRunning === user.max_running)} on:click={() => act('limits', 'update', { max_spaces: Number(maxSpaces), max_running: Number(maxRunning) })}>
            {busy === 'limits' ? 'Saving...' : 'Save'}
          </button>
        </div>
      </section>

      {#if me?.is_superadmin}
        <section>
          <h3>Roles</h3>
          {#if isSelf}
            <p class="note">You can't change your own roles.</p>
          {:else}
            <div class="row">
              {#if user.is_superadmin}
                <button class="btn" disabled={busy !== ''} on:click={() => act('roles', 'roles', { is_superadmin: false }, `Remove superadmin from ${user.username}? They stay an admin.`)}>Remove superadmin</button>
              {:else}
                {#if user.is_admin}
                  <button class="btn" disabled={busy !== ''} on:click={() => act('roles', 'roles', { is_admin: false }, `Remove admin from ${user.username}?`)}>Remove admin</button>
                {:else}
                  <button class="btn" disabled={busy !== ''} on:click={() => act('roles', 'roles', { is_admin: true }, `Make ${user.username} an admin?`)}>Make admin</button>
                {/if}
                <button class="btn" disabled={busy !== ''} on:click={() => act('roles', 'roles', { is_superadmin: true }, `Make ${user.username} a superadmin? They'll be able to open any space, read the admin log and make other superadmins.`)}>Make superadmin</button>
              {/if}
            </div>
          {/if}
        </section>
      {/if}

      {#if me?.is_superadmin}
        <section>
          <h3>Beta</h3>
          <p class="note">
            {user.is_superadmin
              ? 'Superadmins always see beta space types.'
              : user.beta_access
                ? 'They can see and create beta space types. Removing access keeps their existing beta spaces working.'
                : "They can't see beta space types."}
          </p>
          {#if !user.is_superadmin}
            <button class="btn" disabled={busy !== ''} on:click={() => act('beta', 'beta', { beta_access: !user.beta_access })}>
              {busy === 'beta' ? 'Saving...' : user.beta_access ? 'Remove beta access' : 'Give beta access'}
            </button>
          {/if}
        </section>
      {/if}

      <section>
        <h3>Actions</h3>
        <div class="row">
          {#if user.spaceCount > 0}
            <button class="btn" on:click={() => dispatch('showspaces', user)}>Show their spaces</button>
          {/if}
          <button class="btn" disabled={busy !== ''} on:click={() => act('signout', 'sign-out', {}, `Sign ${user.username} out on every device?`)}>
            {busy === 'signout' ? 'Signing out...' : 'Sign out everywhere'}
          </button>
          {#if user.runningCount > 0}
            <button class="btn" disabled={busy !== ''} on:click={() => act('stop', 'stop-spaces', {}, `Stop ${user.username}'s running spaces?`)}>
              {busy === 'stop' ? 'Stopping...' : 'Stop running spaces'}
            </button>
          {/if}
        </div>
      </section>

      {#if !isSelf && !user.is_superadmin}
        <section class="danger">
          <h3>Delete</h3>
          <p class="note">Deletes the account and all {user.spaceCount} of their spaces, including their files. This can't be undone.</p>
          <button class="delete-btn" disabled={busy !== ''} on:click={() => act('delete', 'delete', {}, `Delete ${user.username} and all their spaces? This can't be undone.`)}>
            {busy === 'delete' ? 'Deleting...' : 'Delete user'}
          </button>
        </section>
      {/if}
    {/if}

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
    max-width: 520px;
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

  .badge.strong {
    background: #007bff;
    color: #fff;
  }

  section {
    margin-top: 18px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .row.bottom {
    align-items: flex-end;
  }

  .limit {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }

  input[type="number"] {
    width: 70px;
    padding: 6px;
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

  .btn:disabled,
  .delete-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .delete-btn {
    padding: 6px 12px;
    background-color: #dc3545;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .danger {
    border-top: 1px solid #eee;
    padding-top: 14px;
  }

  .note {
    font-size: 13px;
    color: #666;
    margin: 0 0 8px 0;
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
