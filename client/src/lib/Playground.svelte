<script>
  import { createEventDispatcher } from 'svelte';
  import { currentTheme } from '../stores/theme.js';
  import { themes } from '../themes.js';
  import FlagIcon from '../assets/flag.svg?raw';

  export let username = '';

  const dispatch = createEventDispatcher();

  const playgroundTools = [
    { 
      id: 'godot', 
      name: 'Godot', 
      description: 'Open-source 2D and 3D game engine',
      icon: 'https://godotengine.org/assets/favicon.png',
      status: 'available',
      url: '/godot'
    },
    { 
      id: 'love2d', 
      name: 'LÖVE 2D', 
      description: 'Framework for making 2D games in Lua',
      icon: 'https://love2d.org/apple-touch-icon.png',
      status: 'coming-soon'
    }
  ];

  function handleSignOut() {
    dispatch('signout');
  }

  function handleSettings() {
    dispatch('settings');
  }

  function handleClubs() {
    dispatch('clubs');
  }

  function handleSwitchToSpaces() {
    dispatch('switchview', { view: 'spaces' });
  }

  function launchTool(tool) {
    if (tool.status === 'coming-soon') {
      return;
    }
    if (tool.url) {
      window.location.href = tool.url;
    }
  }

  $: logoColor = (() => {
    const theme = themes[$currentTheme];
    if (theme && theme.colors['--red']) {
      return theme.colors['--red'];
    }
    return '#ec3750';
  })();
</script>

<div class="playground">
  <header class="playground-header">
    <div class="header-content">
      <div class="playground-logo" style="color: {logoColor}">
        {@html FlagIcon}
      </div>
      <div>
        <h1 class="playground-title">Hack Club Spaces Playground</h1>
        <p class="welcome-text">Welcome, {username}!</p>
      </div>
    </div>
    <div class="header-actions">
      <div class="view-switcher">
        <button class="view-tab" on:click={handleSwitchToSpaces}>Spaces</button>
        <button class="view-tab active">Playground</button>
      </div>
      <button class="clubs-button" on:click={handleClubs}>My Club</button>
      <button class="settings-button" on:click={handleSettings}>Settings</button>
      <button class="signout-button" on:click={handleSignOut}>Sign Out</button>
    </div>
  </header>

  <div class="playground-content">
    <div class="browser-notice">
      <span class="notice-text">
        <strong>Browser-only storage:</strong> All playground projects are saved locally in your browser. 
        They will not sync across devices or be backed up to the cloud.
      </span>
    </div>

    <div class="tools-section">
      <h3 class="section-title">Choose a Tool</h3>
      <p class="section-description">
        Pick a language or tool to start coding instantly in your browser.
      </p>

      <div class="tools-grid">
        {#each playgroundTools as tool}
          <button 
            class="tool-card" 
            class:coming-soon={tool.status === 'coming-soon'}
            on:click={() => launchTool(tool)}
            disabled={tool.status === 'coming-soon'}
          >
            <div class="tool-icon">
              {#if tool.icon}
                <img src={tool.icon} alt="{tool.name} icon" />
              {/if}
            </div>
            <div class="tool-info">
              <h4 class="tool-name">{tool.name}</h4>
              <p class="tool-description">{tool.description}</p>
            </div>
            {#if tool.status === 'coming-soon'}
              <span class="coming-soon-badge">Coming Soon</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .playground {
    min-height: 100vh;
    padding: 32px;
    background: var(--snow);
  }

  .playground-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 64px;
    padding-bottom: 32px;
    border-bottom: 2px solid var(--smoke);
  }

  .header-content {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .playground-logo {
    width: 48px;
    height: 48px;
  }

  .playground-logo :global(svg) {
    width: 100%;
    height: 100%;
    fill: currentColor;
  }

  .playground-title {
    font-size: 32px;
    font-weight: bold;
    color: var(--black);
    margin: 0;
  }

  .welcome-text {
    margin: 8px 0 0 0;
    font-size: 16px;
    color: var(--muted);
  }

  .header-actions {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .signout-button {
    padding: 12px 24px;
    background: transparent;
    border: 2px solid var(--red);
    border-radius: 99999px;
    color: var(--red);
    font-size: 16px;
    font-weight: bold;
    font-family: Phantom Sans, sans-serif;
    cursor: pointer;
    transition: transform 0.125s ease-in-out;
    -webkit-tap-highlight-color: transparent;
  }

  .signout-button:hover {
    transform: scale(1.0625);
  }

  .signout-button:active {
    transform: scale(1);
  }

  .settings-button {
    padding: 12px 24px;
    background: transparent;
    border: 2px solid var(--slate);
    border-radius: 99999px;
    color: var(--slate);
    font-size: 16px;
    font-weight: bold;
    font-family: Phantom Sans, sans-serif;
    cursor: pointer;
    transition: transform 0.125s ease-in-out;
    -webkit-tap-highlight-color: transparent;
  }

  .settings-button:hover {
    transform: scale(1.0625);
    border-color: var(--blue);
    color: var(--blue);
  }

  .settings-button:active {
    transform: scale(1);
  }

  .clubs-button {
    padding: 12px 24px;
    background: transparent;
    border: 2px solid var(--green);
    border-radius: 99999px;
    color: var(--green);
    font-size: 16px;
    font-weight: bold;
    font-family: Phantom Sans, sans-serif;
    cursor: pointer;
    transition: transform 0.125s ease-in-out;
    -webkit-tap-highlight-color: transparent;
  }

  .clubs-button:hover {
    transform: scale(1.0625);
    background: rgba(51, 214, 166, 0.1);
  }

  .clubs-button:active {
    transform: scale(1);
  }

  .playground-content {
    max-width: 1200px;
    margin: 0 auto;
  }

  .view-switcher {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--smoke);
    border-radius: 99999px;
  }

  .view-tab {
    padding: 8px 16px;
    background: transparent;
    border: none;
    border-radius: 99999px;
    color: var(--slate);
    font-size: 14px;
    font-weight: bold;
    font-family: Phantom Sans, sans-serif;
    cursor: pointer;
    transition: background 0.125s ease-in-out, color 0.125s ease-in-out;
    -webkit-tap-highlight-color: transparent;
  }

  .view-tab:hover:not(.active) {
    color: var(--black);
  }

  .view-tab.active {
    background: var(--white);
    color: var(--purple);
    cursor: default;
  }

  .browser-notice {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px 20px;
    background: var(--white);
    border: 2px solid var(--orange);
    border-radius: 8px;
    margin-bottom: 32px;
  }

  .notice-icon {
    font-size: 20px;
    flex-shrink: 0;
  }

  .notice-text {
    font-size: 14px;
    color: var(--slate);
    line-height: 1.5;
  }

  .notice-text strong {
    color: var(--orange);
  }

  .tools-section {
    margin-top: 24px;
  }

  .section-title {
    font-size: 24px;
    font-weight: bold;
    color: var(--black);
    margin: 0 0 8px 0;
  }

  .section-description {
    font-size: 16px;
    color: var(--muted);
    margin: 0 0 24px 0;
  }

  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .tool-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    background: var(--white);
    border: 2px solid var(--smoke);
    border-radius: 8px;
    cursor: pointer;
    transition: transform 0.125s ease-in-out, border-color 0.125s ease-in-out;
    text-align: left;
    font-family: Phantom Sans, sans-serif;
    position: relative;
    -webkit-tap-highlight-color: transparent;
  }

  .tool-card:hover:not(:disabled) {
    transform: scale(1.02);
    border-color: var(--purple);
  }

  .tool-card:active:not(:disabled) {
    transform: scale(1);
  }

  .tool-card:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  .tool-card.coming-soon {
    border-color: var(--smoke);
  }

  .tool-card.coming-soon:hover {
    transform: none;
    border-color: var(--smoke);
  }

  .tool-icon {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--snow);
    border-radius: 8px;
    overflow: hidden;
  }

  .tool-icon img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .tool-info {
    flex: 1;
    min-width: 0;
  }

  .tool-name {
    font-size: 18px;
    font-weight: bold;
    color: var(--black);
    margin: 0 0 4px 0;
  }

  .tool-description {
    font-size: 14px;
    color: var(--muted);
    margin: 0;
    line-height: 1.4;
  }

  .coming-soon-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    padding: 4px 10px;
    background: var(--muted);
    color: var(--white);
    font-size: 12px;
    font-weight: bold;
    border-radius: 99999px;
  }

  @media (max-width: 768px) {
    .playground {
      padding: 16px;
    }

    .playground-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 16px;
    }

    .view-switcher {
      flex-direction: column;
      width: 100%;
    }

    .view-tab {
      width: 100%;
      text-align: center;
    }

    .tools-grid {
      grid-template-columns: 1fr;
    }

    .browser-notice {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
  }
</style>
