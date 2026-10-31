<script>
  import { onMount, onDestroy } from "svelte";

  export let expectedSeconds = 60;
  export let steps = [];
  export let note = "";
  export let done = false;

  let elapsed = 0;
  let timer;

  onMount(() => {
    const started = Date.now();
    timer = setInterval(() => {
      elapsed = (Date.now() - started) / 1000;
    }, 250);
  });

  onDestroy(() => clearInterval(timer));

  $: percent = done ? 100 : Math.round(95 * (1 - Math.exp((-2.5 * elapsed) / expectedSeconds)));
  $: stepIndex = Math.min(steps.length - 1, Math.floor((elapsed / expectedSeconds) * steps.length));
  $: label = done ? "Ready!" : steps[stepIndex] || "";
</script>

<div class="progress-notice" role="status" aria-live="polite">
  {#if label}
    <div class="progress-label">{label}</div>
  {/if}
  <div class="progress-track">
    <div class="progress-fill" class:done style="width: {percent}%"></div>
  </div>
  {#if note}
    <p class="progress-note">{note}</p>
  {/if}
</div>

<style>
  .progress-notice {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .progress-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--black);
  }

  .progress-track {
    width: 100%;
    height: 8px;
    background: var(--smoke);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--blue);
    border-radius: 4px;
    transition: width 0.25s linear;
  }

  .progress-fill.done {
    transition: width 0.3s ease-out;
  }

  .progress-note {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }
</style>
