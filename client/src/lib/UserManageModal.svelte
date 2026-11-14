<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { API_BASE } from '../config.js';
  import { createConfirm } from './confirm.js';

  const confirmer = createConfirm(6000);
  const { armed } = confirmer;
  let prompts = {};

  export let user;
  export let me;

  const dispatch = createEventDispatcher();
  const can = (permission) => Boolean(me?.is_superadmin || me?.permissions?.includes(permission));

  let maxSpaces = user.max_spaces;
  let maxRunning = user.max_running;
  let busy = '';
  let message = '';
  let error = '';
  let allRoles = [];
  let chosenRoles = new Set((user.roles ?? []).map((role) => role.id));

  $: isSelf = me?.email === user.email;
  $: isStaff = user.is_superadmin || (user.roles ?? []).some((role) => role.staff);
  $: canManage = me?.is_superadmin || !isStaff;
  $: currentRoleIds = (user.roles ?? []).map((role) => role.id);
  $: rolesChanged = chosenRoles.size !== currentRoleIds.length || currentRoleIds.some((id) => !chosenRoles.has(id));
  $: hasActions = can('users.sign_out') || (can('users.stop_spaces') && user.runningCount > 0) || (can('spaces.view') && user.spaceCount > 0);

  onMount(async () => {
    if (!me?.is_superadmin) return;
    try {
      const response = await fetch(`${API_BASE}/admin/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) allRoles = data.data.roles;
    } catch (err) {
      console.error('Failed to load roles:', err);
    }
  });

  function toggleRole(id) {
    if (chosenRoles.has(id)) chosenRoles.delete(id);
    else chosenRoles.add(id);
    chosenRoles = chosenRoles;
  }

  function act(name, path, body = {}, confirmText = null) {
    if (!confirmText) return run(name, path, body);
    const key = `${name}:${path}:${JSON.stringify(body)}`;
    prompts = { ...prompts, [key]: confirmText };
    message = '';
    error = '';
    return confirmer.ask(key, () => run(name, path, body));
  }

  async function run(name, path, body) {
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
      if (path === 'roles') chosenRoles = new Set((user.roles ?? []).map((role) => role.id));
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
      {#if user.is_superadmin}<span class="badge strong">Superadmin</span>{/if}
      {#each user.roles ?? [] as role}<span class="badge strong">{role.name}</span>{/each}
      {#if user.club_leader}<span class="badge">Club leader</span>{:else if user.in_club}<span class="badge">Club member</span>{/if}
      <span class="badge">{user.hackclub_linked ? `Hack Club: ${user.hackclub_verification_status || 'linked'}` : 'No Hack Club account'}</span>
      {#if user.has_password}<span class="badge">Club password login</span>{/if}
      {#if user.beta_access}<span class="badge">Beta tester</span>{/if}
      <span class="badge">{user.spaceCount} space{user.spaceCount === 1 ? '' : 's'}{user.runningCount ? `, ${user.runningCount} running` : ''}</span>
    </div>

    {#if !canManage}
      <p class="note">Only superadmins can manage people with roles.</p>
    {:else}
      {#if can('users.limits')}
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
      {/if}

      {#if me?.is_superadmin}
        <section>
          <h3>Roles</h3>
          {#if allRoles.length}
            <div class="role-list">
              {#each allRoles as role}
                <label class="role-option">
                  <input type="checkbox" checked={chosenRoles.has(role.id)} on:change={() => toggleRole(role.id)} />
                  <span>
                    <strong>{role.name}</strong>
                    {#if role.description}<span class="role-desc">{role.description}</span>{/if}
                  </span>
                </label>
              {/each}
            </div>
            <button class="btn" disabled={busy !== '' || !rolesChanged} on:click={() => act('roles', 'roles', { roleIds: [...chosenRoles] })}>
              {busy === 'roles' ? 'Saving...' : 'Save roles'}
            </button>
          {:else}
            <p class="note">Loading roles...</p>
          {/if}
        </section>

        <section>
          <h3>Superadmin</h3>
          {#if isSelf}
            <p class="note">You can't change your own superadmin.</p>
          {:else if user.is_superadmin}
            <p class="note">Superadmins have every permission and manage roles. Their roles above still apply if superadmin is removed.</p>
            <button class="btn" disabled={busy !== ''} on:click={() => act('superadmin', 'superadmin', { is_superadmin: false }, `Remove superadmin from ${user.username}? They keep their roles.`)}>Remove superadmin</button>
          {:else}
            <button class="btn" disabled={busy !== ''} on:click={() => act('superadmin', 'superadmin', { is_superadmin: true }, `Make ${user.username} a superadmin? They'll get every permission, including managing roles and other superadmins.`)}>Make superadmin</button>
          {/if}
        </section>
      {/if}

      {#if can('beta.manage')}
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

      {#if hasActions}
        <section>
          <h3>Actions</h3>
          <div class="row">
            {#if can('spaces.view') && user.spaceCount > 0}
              <button class="btn" on:click={() => dispatch('showspaces', user)}>Show their spaces</button>
            {/if}
            {#if can('users.sign_out')}
              <button class="btn" disabled={busy !== ''} on:click={() => act('signout', 'sign-out', {}, `Sign ${user.username} out on every device?`)}>
                {busy === 'signout' ? 'Signing out...' : 'Sign out everywhere'}
              </button>
            {/if}
            {#if can('users.stop_spaces') && user.runningCount > 0}
              <button class="btn" disabled={busy !== ''} on:click={() => act('stop', 'stop-spaces', {}, `Stop ${user.username}'s running spaces?`)}>
                {busy === 'stop' ? 'Stopping...' : 'Stop running spaces'}
              </button>
            {/if}
          </div>
        </section>
      {/if}

      {#if can('users.delete') && !isSelf && !user.is_superadmin}
        <section class="danger">
          <h3>Delete</h3>
          <p class="note">Deletes the account and all {user.spaceCount} of their spaces, including their files. This can't be undone.</p>
          <button class="delete-btn" disabled={busy !== ''} on:click={() => act('delete', 'delete', {}, `Delete ${user.username} and all their spaces? This can't be undone.`)}>
            {busy === 'delete' ? 'Deleting...' : 'Delete user'}
          </button>
        </section>
      {/if}
    {/if}

    {#if $armed && prompts[$armed]}<p class="result prompt">{prompts[$armed]} Click the same button again to confirm.</p>{/if}
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

  .role-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }

  .role-option {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 13px;
    cursor: pointer;
  }

  .role-desc {
    display: block;
    color: #666;
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

  .result.prompt {
    color: #b45309;
  }

  .result.error {
    color: #c82333;
  }
</style>
