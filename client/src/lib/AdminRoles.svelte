<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { API_BASE } from '../config.js';
  import { createConfirm } from './confirm.js';

  export let users = [];

  const dispatch = createEventDispatcher();
  const confirmer = createConfirm(6000);
  const { armed } = confirmer;

  let roles = [];
  let permissions = [];
  let loading = true;
  let loadError = '';
  let selectedId = null;
  let draft = null;
  let members = [];
  let membersLoading = false;
  let memberSearch = '';
  let busy = '';
  let message = '';
  let error = '';

  $: categories = [...new Set(permissions.map((permission) => permission.category))];
  $: selected = roles.find((role) => role.id === selectedId) ?? null;
  $: isNew = draft && draft.id === null;
  $: changed = draft && (isNew || !selected || draft.name !== selected.name || (draft.description ?? '') !== (selected.description ?? '')
    || draft.permissions.length !== selected.permissions.length || draft.permissions.some((key) => !selected.permissions.includes(key)));
  $: memberIds = new Set(members.map((member) => member.id));
  $: candidates = memberSearch.trim()
    ? users
      .filter((user) => !memberIds.has(user.id))
      .filter((user) => [user.username, user.email, String(user.id)].some((value) => value?.toLowerCase().includes(memberSearch.trim().toLowerCase())))
      .slice(0, 8)
    : [];

  async function api(path, body = {}) {
    const response = await fetch(`${API_BASE}/admin/roles${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Something went wrong.');
    return data;
  }

  async function loadRoles() {
    try {
      const { data } = await api('');
      roles = data.roles;
      permissions = data.permissions;
      loadError = '';
    } catch (err) {
      loadError = err.message;
    } finally {
      loading = false;
    }
  }

  async function loadMembers(roleId) {
    membersLoading = true;
    try {
      members = (await api(`/${roleId}/members`)).data;
    } catch (err) {
      error = err.message;
    } finally {
      membersLoading = false;
    }
  }

  function pick(role) {
    selectedId = role.id;
    draft = { id: role.id, name: role.name, description: role.description ?? '', permissions: [...role.permissions] };
    members = [];
    memberSearch = '';
    message = '';
    error = '';
    confirmer.disarm();
    loadMembers(role.id);
  }

  function startNew() {
    selectedId = null;
    draft = { id: null, name: '', description: '', permissions: [] };
    members = [];
    message = '';
    error = '';
  }

  function togglePermission(key) {
    draft.permissions = draft.permissions.includes(key)
      ? draft.permissions.filter((existing) => existing !== key)
      : [...draft.permissions, key];
  }

  function toggleCategory(category) {
    const keys = permissions.filter((permission) => permission.category === category).map((permission) => permission.key);
    const allOn = keys.every((key) => draft.permissions.includes(key));
    draft.permissions = allOn
      ? draft.permissions.filter((key) => !keys.includes(key))
      : [...new Set([...draft.permissions, ...keys])];
  }

  async function run(name, action) {
    busy = name;
    message = '';
    error = '';
    try {
      await action();
    } catch (err) {
      error = err.message;
    } finally {
      busy = '';
    }
  }

  const save = () => run('save', async () => {
    const body = { name: draft.name, description: draft.description, permissions: draft.permissions };
    const result = isNew ? await api('/create', body) : await api(`/${draft.id}/update`, body);
    await loadRoles();
    const role = roles.find((existing) => existing.id === result.data.id);
    if (role) pick(role);
    message = result.message;
    dispatch('changed');
  });

  const remove = () => run('delete', async () => {
    const result = await api(`/${draft.id}/delete`);
    selectedId = null;
    draft = null;
    await loadRoles();
    message = result.message;
    dispatch('changed');
  });

  const changeMember = (user, adding) => run(`member-${user.id}`, async () => {
    const result = await api(`/${selectedId}/members/${adding ? 'add' : 'remove'}`, { userId: user.id });
    memberSearch = '';
    await Promise.all([loadMembers(selectedId), loadRoles()]);
    message = result.message;
    dispatch('changed');
  });

  onMount(loadRoles);
</script>

<div class="roles">
  {#if loading}
    <p class="note">Loading roles...</p>
  {:else if loadError}
    <p class="result error">{loadError}</p>
  {:else}
    <div class="role-list">
      <div class="list-header">
        <h2>Roles</h2>
        <button class="btn" on:click={startNew}>New role</button>
      </div>
      <p class="note">Someone's permissions are everything from all of their roles together. Superadmins have every permission.</p>
      {#each roles as role (role.id)}
        <button class="role-row" class:active={role.id === selectedId} on:click={() => pick(role)}>
          <span class="role-name">{role.name}</span>
          <span class="role-meta">{role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'} · {role.memberCount} {role.memberCount === 1 ? 'person' : 'people'}</span>
          {#if role.description}<span class="role-meta">{role.description}</span>{/if}
        </button>
      {/each}
    </div>

    {#if draft}
      <div class="editor">
        <h2>{isNew ? 'New role' : draft.name || 'Untitled role'}</h2>

        <label class="field">
          Name
          <input type="text" maxlength="40" bind:value={draft.name} placeholder="Moderator" />
        </label>
        <label class="field">
          Description
          <input type="text" maxlength="200" bind:value={draft.description} placeholder="What this role is for" />
        </label>

        <h3>Permissions</h3>
        {#each categories as category}
          <fieldset>
            <legend>
              <button class="link" on:click={() => toggleCategory(category)}>{category}</button>
            </legend>
            {#each permissions.filter((permission) => permission.category === category) as permission}
              <label class="permission">
                <input type="checkbox" checked={draft.permissions.includes(permission.key)} on:change={() => togglePermission(permission.key)} />
                <span>{permission.label} <code>{permission.key}</code></span>
              </label>
            {/each}
          </fieldset>
        {/each}

        <div class="row">
          <button class="btn primary" disabled={busy !== '' || !changed || !draft.name.trim()} on:click={save}>
            {busy === 'save' ? 'Saving...' : isNew ? 'Create role' : 'Save role'}
          </button>
          {#if !isNew}
            <button class="btn" disabled={busy !== '' || changed} title={changed ? 'Save your changes first' : ''} on:click={() => dispatch('viewas', selected)}>
              See the panel as this role
            </button>
            <button class="btn danger" disabled={busy !== '' || members.length > 0} title={members.length ? 'Remove everyone from this role first' : ''} on:click={() => confirmer.ask('delete-role', remove)}>
              {busy === 'delete' ? 'Deleting...' : $armed === 'delete-role' ? 'Really delete?' : 'Delete role'}
            </button>
          {/if}
        </div>
        {#if !isNew && members.length > 0}<p class="note">To delete this role, remove everyone from it first.</p>{/if}

        {#if !isNew}
          <h3>People with this role</h3>
          <input type="text" class="search" bind:value={memberSearch} placeholder="Add someone: search by username, email or ID" />
          {#if candidates.length}
            <ul class="people">
              {#each candidates as user (user.id)}
                <li>
                  <span>{user.username} <span class="role-meta">{user.email}</span></span>
                  <button class="btn" disabled={busy !== ''} on:click={() => changeMember(user, true)}>Add</button>
                </li>
              {/each}
            </ul>
          {:else if memberSearch.trim()}
            <p class="note">Nobody else matches.</p>
          {/if}

          {#if membersLoading}
            <p class="note">Loading people...</p>
          {:else if members.length === 0}
            <p class="note">Nobody has this role yet.</p>
          {:else}
            <ul class="people">
              {#each members as member (member.id)}
                <li>
                  <span>
                    {member.username}
                    {#if member.is_superadmin}<span class="tag">Superadmin</span>{/if}
                    <span class="role-meta">{member.email}</span>
                  </span>
                  <button class="btn" disabled={busy !== ''} on:click={() => changeMember(member, false)}>
                    {busy === `member-${member.id}` ? 'Removing...' : 'Remove'}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}

        {#if $armed === 'delete-role'}<p class="result prompt">Delete the {draft.name} role? Click the same button again to confirm.</p>{/if}
        {#if message}<p class="result">{message}</p>{/if}
        {#if error}<p class="result error">{error}</p>{/if}
      </div>
    {:else}
      <p class="note">Pick a role to edit it and see who has it, or make a new one.</p>
      {#if message}<p class="result">{message}</p>{/if}
    {/if}
  {/if}
</div>

<style>
  .roles {
    display: grid;
    grid-template-columns: minmax(220px, 300px) 1fr;
    gap: 24px;
    align-items: start;
  }

  @media (max-width: 720px) {
    .roles {
      grid-template-columns: 1fr;
    }
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  h3 {
    margin: 20px 0 8px 0;
    font-size: 14px;
    color: #666;
  }

  .list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .role-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .role-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: 10px 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .role-row.active {
    border-color: #007bff;
    box-shadow: 0 0 0 1px #007bff;
  }

  .role-name {
    font-weight: bold;
  }

  .role-meta {
    font-size: 12px;
    color: #666;
  }

  .editor {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 16px;
    min-width: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 12px;
    font-size: 13px;
  }

  input[type="text"] {
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    width: 100%;
    box-sizing: border-box;
  }

  .search {
    margin-bottom: 8px;
  }

  fieldset {
    border: 1px solid #eee;
    border-radius: 6px;
    margin: 0 0 10px 0;
    padding: 8px 12px;
  }

  legend {
    padding: 0 4px;
  }

  .permission {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 13px;
    padding: 3px 0;
    cursor: pointer;
  }

  code {
    font-size: 11px;
    color: #666;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
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

  .btn.danger {
    background: #dc3545;
    border-color: #dc3545;
    color: #fff;
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    font-weight: bold;
    font-size: 13px;
    color: #007bff;
    cursor: pointer;
  }

  .people {
    list-style: none;
    padding: 0;
    margin: 0 0 8px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .people li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    padding: 6px 0;
    border-bottom: 1px solid #eee;
  }

  .people .role-meta {
    display: block;
  }

  .tag {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    background: #007bff;
    color: #fff;
    margin-left: 4px;
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

  .result.prompt {
    color: #b45309;
  }

  .result.error {
    color: #c82333;
  }
</style>
