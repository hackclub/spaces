<script>
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { API_BASE } from "../config.js";
  import { userData } from "../stores/user.svelte";

  export let space;

  const dispatch = createEventDispatcher();
  const POLL_MS = 4000;

  let dialog;
  let state = "loading";
  let login = "";
  let code = "";
  let url = "";
  let error = "";
  let copied = false;
  let confirmDisconnect = false;
  let pollTimer;

  async function request(path, method = "GET") {
    const response = await fetch(`${API_BASE}/spaces/github/${space.id}${path}`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  function show(status) {
    if (status.connected) {
      login = status.login;
      state = "connected";
      stopPolling();
      if (userData.user?.github_username !== status.login) userData.refresh();
    } else if (status.code) {
      code = status.code;
      url = status.url;
      state = "waiting";
      startPolling();
    } else if (state === "waiting" && !status.pending) {
      state = "expired";
      stopPolling();
    } else if (state !== "waiting") {
      state = "disconnected";
    }
  }

  async function load() {
    try {
      show(await request(""));
    } catch (err) {
      error = err.message;
      state = "error";
    }
  }

  async function connect() {
    state = "starting";
    error = "";
    try {
      show(await request("/connect", "POST"));
    } catch (err) {
      error = err.message;
      state = "error";
    }
  }

  async function disconnect() {
    if (!confirmDisconnect) {
      confirmDisconnect = true;
      setTimeout(() => (confirmDisconnect = false), 4000);
      return;
    }
    confirmDisconnect = false;
    state = "loading";
    try {
      await request("/disconnect", "POST");
      login = "";
      state = "disconnected";
    } catch (err) {
      error = err.message;
      state = "error";
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        show(await request(""));
      } catch (err) {
        error = err.message;
      }
    }, POLL_MS);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (err) {
      copied = false;
    }
  }

  function close() {
    stopPolling();
    dialog?.close();
    dispatch("close");
  }

  onMount(() => {
    dialog.showModal();
    load();
  });

  onDestroy(stopPolling);
</script>

<dialog
  class="github-dialog"
  bind:this={dialog}
  aria-labelledby="github-dialog-title"
  on:cancel|preventDefault={close}
  on:click={(event) => event.target === dialog && close()}
>
  <div class="github-body">
    <div class="github-head">
      <h3 id="github-dialog-title">GitHub</h3>
      <button type="button" class="github-close" on:click={close} aria-label="Close">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg>
      </button>
    </div>

    {#if state === "loading" || state === "starting"}
      <p class="github-text">{state === "starting" ? "Starting the GitHub login..." : "Checking this space..."}</p>
    {:else if state === "connected"}
      <p class="github-text">Connected as <strong>@{login}</strong>. You can push from this space, and commits show up on your GitHub account.</p>
      <div class="github-row">
        <button type="button" class="btn-secondary small" on:click={disconnect}>
          {confirmDisconnect ? "Click again to disconnect" : "Disconnect"}
        </button>
      </div>
    {:else if state === "waiting"}
      <p class="github-text">Open GitHub, sign in if you need to, and enter this code:</p>
      <div class="github-code" aria-live="polite">{code}</div>
      <div class="github-row">
        <button type="button" class="btn-secondary small" on:click={copyCode}>{copied ? "Copied" : "Copy code"}</button>
        <a class="btn-primary small" href={url} target="_blank" rel="noopener noreferrer">Open GitHub</a>
      </div>
      <p class="github-hint">This window updates by itself once you're done.</p>
    {:else if state === "expired"}
      <p class="github-text">That code wasn't used in time.</p>
      <div class="github-row">
        <button type="button" class="btn-primary small" on:click={connect}>Get a new code</button>
      </div>
    {:else if state === "error"}
      <p class="github-text error">{error}</p>
      <div class="github-row">
        <button type="button" class="btn-secondary small" on:click={load}>Try again</button>
      </div>
    {:else}
      <p class="github-text">Connect GitHub to push your work from this space and start new spaces from your repos.</p>
      <div class="github-row">
        <button type="button" class="btn-primary small" on:click={connect}>Connect GitHub</button>
      </div>
    {/if}
  </div>
</dialog>

<style>
  .github-dialog {
    width: min(440px, calc(100vw - 32px));
    padding: 0;
    border: none;
    border-radius: 12px;
    background: var(--white);
    color: var(--black);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
  }

  .github-dialog:focus {
    outline: none;
  }

  .github-dialog::backdrop {
    background: rgba(18, 18, 23, 0.6);
  }

  .github-body {
    padding: 24px;
  }

  .github-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  h3 {
    margin: 0;
    font-size: 22px;
  }

  .github-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 2px solid var(--smoke);
    border-radius: 99999px;
    background: transparent;
    color: var(--slate);
    cursor: pointer;
  }

  .github-close:hover {
    border-color: var(--red);
    color: var(--red);
  }

  .github-text {
    margin: 0 0 16px 0;
    font-size: 15px;
    line-height: 1.5;
    color: var(--slate);
  }

  .github-text.error {
    color: var(--red);
  }

  .github-code {
    margin: 0 0 16px 0;
    padding: 14px;
    border: 2px dashed var(--smoke);
    border-radius: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 28px;
    font-weight: bold;
    letter-spacing: 0.12em;
    text-align: center;
    color: var(--black);
  }

  .github-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .small {
    padding: 10px 20px;
    font-size: 14px;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }

  .github-hint {
    margin: 14px 0 0 0;
    font-size: 13px;
    color: var(--slate);
  }
</style>
