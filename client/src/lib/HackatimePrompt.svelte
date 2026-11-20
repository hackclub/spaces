<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { API_BASE } from "../config.js";

  const dispatch = createEventDispatcher();

  let step = "ask"; // "ask" while the popup is open, "toast" after "Maybe later"
  let loading = false;
  let error = "";
  let toastTimer;

  const markAnswered = () =>
    fetch(`${API_BASE}/users/hackatime-prompt`, {
      method: "POST",
      credentials: "include",
    }).catch((err) => console.error("Failed to save Hackatime prompt answer:", err));

  async function connect() {
    error = "";
    loading = true;
    try {
      await markAnswered();
      const response = await fetch(`${API_BASE}/oauth/hackatime/link`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (response.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      error = data.message || "Couldn't start connecting Hackatime. You can try again from Settings.";
    } catch (err) {
      console.error(err);
      error = "Couldn't start connecting Hackatime. You can try again from Settings.";
    }
    loading = false;
  }

  function later() {
    if (loading) return;
    step = "toast";
    markAnswered();
    toastTimer = setTimeout(() => dispatch("close"), 5000);
  }

  onDestroy(() => clearTimeout(toastTimer));
</script>

<svelte:window on:keydown={(e) => e.key === "Escape" && step === "ask" && later()} />

{#if step === "ask"}
  <div class="overlay" role="presentation" on:click|self={later}>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="hackatime-prompt-title">
      <h2 id="hackatime-prompt-title">Track your time with Hackatime?</h2>
      <p>
        Connect Hackatime and your spaces will log your coding time automatically,
        so it counts toward YSWS programs.
      </p>
      {#if error}<p class="error">{error}</p>{/if}
      <div class="actions">
        <button class="secondary" on:click={later} disabled={loading}>Maybe later</button>
        <button class="primary" on:click={connect} disabled={loading}>
          {loading ? "Redirecting…" : "Yes, connect Hackatime"}
        </button>
      </div>
    </div>
  </div>
{:else}
  <div class="toast" role="status">
    You can always set up your Hackatime connection in <strong>Settings</strong>.
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 1000;
  }

  .modal {
    background: var(--white);
    color: var(--text);
    border-radius: 12px;
    padding: 24px;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
  }

  h2 {
    margin: 0 0 8px;
    font-size: 1.3rem;
  }

  p {
    margin: 0 0 20px;
    color: var(--muted);
    line-height: 1.5;
  }

  .error {
    color: var(--red);
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .actions button {
    padding: 10px 16px;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
  }

  .actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .primary {
    background: var(--red);
    color: var(--white);
    border: none;
  }

  .secondary {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--muted);
  }

  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--white);
    color: var(--text);
    border: 1px solid var(--muted);
    border-radius: 8px;
    padding: 12px 18px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
    z-index: 1000;
    max-width: calc(100% - 32px);
  }
</style>
