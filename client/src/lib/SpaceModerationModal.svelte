<script>
  import { createEventDispatcher } from 'svelte';
  import { API_BASE } from '../config.js';

  export let space;

  const dispatch = createEventDispatcher();

  const SHORTCUTS = [
    { label: 'Workspace', path: '/vercel/sandbox' },
    { label: 'Home folders', path: '/home' },
    { label: 'Whole machine', path: '/' }
  ];

  let explorer = null;
  let explored = false;
  let pathInput = '/vercel/sandbox';
  let filesLoading = false;
  let filesError = '';
  let preview = null;
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

  async function post(path, body) {
    return fetch(`${API_BASE}/admin/moderation/spaces/${space.id}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
  }

  async function browse(dir) {
    filesLoading = true;
    filesError = '';
    preview = null;
    explored = true;
    try {
      const response = await post('files', { path: dir });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        filesError = data.message || "Couldn't list that folder.";
        return;
      }
      explorer = data.data;
      pathInput = explorer.path;
    } catch (err) {
      filesError = 'Network error. Please try again.';
    } finally {
      filesLoading = false;
    }
  }

  const childPath = (name) => `${explorer.path === '/' ? '' : explorer.path}/${name}`;

  async function openFile(file) {
    filesLoading = true;
    filesError = '';
    try {
      const response = await post('file', { path: file });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        filesError = data.message || "Couldn't open that file.";
        return;
      }
      preview = data.data;
    } catch (err) {
      filesError = 'Network error. Please try again.';
    } finally {
      filesLoading = false;
    }
  }

  async function download(file) {
    filesError = '';
    try {
      const response = await post('file', { path: file, download: true });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        filesError = data.message || "Couldn't download that file.";
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = file.split('/').pop() || 'file';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      filesError = 'Network error. Please try again.';
    }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function close() {
    if (explored && !space.running) {
      post('release', {}).catch(() => {});
    }
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

    <section>
      <h3>Files</h3>
      {#if !explorer}
        <p class="note">Browse and download this space's files without opening it. A stopped space wakes up for this and is stopped again when you close this window.</p>
      {/if}
      <div class="row">
        {#each SHORTCUTS as shortcut}
          <button class="btn" disabled={filesLoading} on:click={() => browse(shortcut.path)}>{shortcut.label}</button>
        {/each}
      </div>
      <form class="row path-row" on:submit|preventDefault={() => browse(pathInput)}>
        <input type="text" bind:value={pathInput} aria-label="Folder path" />
        <button class="btn" type="submit" disabled={filesLoading}>Go</button>
      </form>
      {#if filesLoading}
        <p class="note">{explorer ? 'Loading...' : 'Waking the space up, this can take a few seconds...'}</p>
      {/if}
      {#if filesError}<p class="result error">{filesError}</p>{/if}
      {#if explorer}
        <div class="files">
          {#if explorer.parent}
            <button class="file-row" on:click={() => browse(explorer.parent)}><span>📁 ..</span><span></span></button>
          {/if}
          {#each explorer.entries as entry (entry.name)}
            {#if entry.type === 'folder'}
              <button class="file-row" on:click={() => browse(childPath(entry.name))}><span>📁 {entry.name}</span><span class="muted">{new Date(entry.modified).toLocaleDateString()}</span></button>
            {:else}
              <div class="file-row">
                <button class="file-name" on:click={() => openFile(childPath(entry.name))}>{entry.type === 'link' ? '🔗' : '📄'} {entry.name}</button>
                <span class="muted">{formatSize(entry.size)} · {new Date(entry.modified).toLocaleDateString()}
                  <button class="link" on:click={() => download(childPath(entry.name))}>Download</button>
                </span>
              </div>
            {/if}
          {:else}
            <p class="note">This folder is empty.</p>
          {/each}
        </div>
      {/if}
      {#if preview}
        <div class="preview">
          <div class="preview-head">
            <strong>{preview.path}</strong>
            <span>
              <button class="link" on:click={() => download(preview.path)}>Download</button>
              <button class="link" on:click={() => (preview = null)}>Close</button>
            </span>
          </div>
          {#if preview.binary}
            <p class="note">Not a text file ({formatSize(preview.size)}). Download it to look inside.</p>
          {:else}
            <pre>{preview.text}</pre>
          {/if}
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

  .path-row {
    margin-top: 8px;
  }

  .files {
    margin-top: 10px;
    border: 1px solid #eee;
    border-radius: 6px;
    max-height: 320px;
    overflow-y: auto;
  }

  .file-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    border-bottom: 1px solid #f3f3f3;
    font: inherit;
    font-size: 13px;
    text-align: left;
    color: inherit;
  }

  button.file-row {
    cursor: pointer;
  }

  button.file-row:hover,
  .file-name:hover {
    background: #f7f9fc;
  }

  .file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }

  .link {
    margin-left: 8px;
    padding: 0;
    background: none;
    border: none;
    color: #007bff;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }

  .preview {
    margin-top: 12px;
    border: 1px solid #eee;
    border-radius: 6px;
  }

  .preview-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 10px;
    border-bottom: 1px solid #eee;
    font-size: 13px;
    word-break: break-all;
  }

  pre {
    margin: 0;
    padding: 10px;
    max-height: 360px;
    overflow: auto;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
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
