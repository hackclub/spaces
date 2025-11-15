<script>
  import { currentTheme, setTheme } from '../stores/theme.js';
  import { themes } from '../themes.js';

  let isOpen = false;

  function toggleMenu() {
    isOpen = !isOpen;
  }

  function selectTheme(themeName) {
    setTheme(themeName);
    isOpen = false;
  }

  function handleClickOutside(event) {
    if (isOpen && !event.target.closest('.theme-switcher')) {
      isOpen = false;
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

<div class="theme-switcher">
  <button class="theme-toggle" on:click|stopPropagation={toggleMenu} aria-label="Switch theme">
    Theme: {themes[$currentTheme]?.name || 'light'}
  </button>

  {#if isOpen}
    <div class="theme-menu">
      {#each Object.entries(themes) as [key, theme]}
        <button
          class="theme-option"
          class:active={$currentTheme === key}
          on:click={() => selectTheme(key)}
        >
          {theme.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .theme-switcher {
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 1000;
  }

  .theme-toggle {
    padding: 8px 16px;
    background: var(--white);
    border: 2px solid var(--smoke);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    color: var(--black);
    transition: all 0.15s ease;
    font-family: 'Phantom Sans', sans-serif;
  }

  .theme-toggle:hover {
    border-color: var(--blue);
    background: var(--snow);
  }

  .theme-menu {
    position: absolute;
    bottom: 42px;
    left: 0;
    background: var(--white);
    border: 2px solid var(--smoke);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    overflow: hidden;
    animation: slideUp 0.2s ease;
    display: flex;
    flex-direction: column;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .theme-option {
    padding: 8px 16px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: var(--black);
    text-align: left;
    transition: all 0.1s ease;
    font-family: 'Phantom Sans', sans-serif;
    white-space: nowrap;
  }

  .theme-option:hover {
    background: var(--snow);
  }

  .theme-option.active {
    background: var(--blue);
    color: var(--white);
    font-weight: 700;
  }

  @media (max-width: 768px) {
    .theme-switcher {
      bottom: 16px;
      left: 16px;
    }
  }
</style>
