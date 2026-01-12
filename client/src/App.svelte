<script>
  import { onMount } from 'svelte';
  import Landing from './lib/Landing.svelte';
  import Auth from './lib/Auth.svelte';
  import Dashboard from './lib/Dashboard.svelte';
  import Playground from './lib/Playground.svelte';
  import AdminPanel from './lib/AdminPanel.svelte';
  import ThemeSwitcher from './lib/ThemeSwitcher.svelte';
  import Settings from './lib/Settings.svelte';
  import Clubs from './lib/Clubs.svelte';
  import { API_BASE } from './config.js';
  import { applyTheme, currentTheme } from './stores/theme.js';
  import { get } from 'svelte/store';
  import { getCookie } from './utils/cookies.js';

  let isAuthenticated = false;
  let user = null;
  let spaces = [];
  let showAdminPanel = false;
  let showSettings = false;
  let showClubs = false;
  let showAuth = false;
  let currentView = 'spaces';

  onMount(() => {
    applyTheme(get(currentTheme));
    
    // Check for OAuth callback before restoring session
    const hash = window.location.hash.startsWith('#') 
      ? window.location.hash.slice(1) 
      : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    
    if (hashParams.get('oauth_success') === 'true') {
      const userData = hashParams.get('user_data');
      if (userData) {
        try {
          const parsed = JSON.parse(decodeURIComponent(userData));
          user = {
            authorization: parsed.authorization,
            username: parsed.username,
            email: parsed.email,
            is_admin: parsed.is_admin,
            hackatime_api_key: parsed.hackatime_api_key,
            hackclub_id: parsed.hackclub_id,
            hackclub_verification_status: parsed.hackclub_verification_status
          };
          saveSession(user);
          isAuthenticated = true;
          loadSpaces();
          window.history.replaceState({}, '', window.location.pathname);
          return;
        } catch (e) {
          console.error('Failed to parse OAuth user data:', e);
        }
      }
    }
    
    restoreSession();
  });

  function restoreSession() {
    const savedUser = localStorage.getItem('spaces_user');
    if (savedUser) {
      try {
        user = JSON.parse(savedUser);
        isAuthenticated = true;
        loadSpaces();
      } catch (e) {
        localStorage.removeItem('spaces_user');
      }
    }
  }

  function saveSession(userData) {
    localStorage.setItem('spaces_user', JSON.stringify(userData));
  }

  function clearSession() {
    localStorage.removeItem('spaces_user');
  }

  function handleAuthenticated(event) {
    const { authorization, username, email, is_admin, hackatime_api_key, hackclub_id, hackclub_verification_status } = event.detail;

    user = {
      authorization,
      username,
      email,
      is_admin,
      hackatime_api_key,
      hackclub_id,
      hackclub_verification_status
    };

    saveSession(user);
    isAuthenticated = true;
    loadSpaces();
  }
  
  function handleUserUpdate(event) {
    user = { ...user, ...event.detail };
    saveSession(user);
  }

  async function loadSpaces() {
    if (!user) return;
    
    try {
      const response = await fetch(`${API_BASE}/spaces/list`, {
        headers: {
          'Authorization': user.authorization,
        },
      });
      
      const data = await response.json();
      
      if (response.ok) {
        spaces = data.spaces;
      }
    } catch (err) {
      console.error('Failed to load spaces:', err);
    }
  }

  async function handleSignOut() {
    if (user) {
      try {
        await fetch(`${API_BASE}/users/signout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ authorization: user.authorization }),
        });
      } catch (err) {
        console.error('Sign out error:', err);
      }
    }

    clearSession();
    isAuthenticated = false;
    user = null;
    spaces = [];
  }
</script>

<main>
  {#if isAuthenticated && user}
    <ThemeSwitcher />
    {#if showAdminPanel && user.is_admin}
      <div class="nav-header">
        <button on:click={() => showAdminPanel = false}>Back to Dashboard</button>
      </div>
      <AdminPanel authorization={user.authorization} />
    {:else if showSettings}
      <div class="nav-header">
        <button on:click={() => showSettings = false}>Back to Dashboard</button>
      </div>
      <Settings {user} authorization={user.authorization} on:update={handleUserUpdate} />
    {:else if showClubs}
      <div class="nav-header">
        <button on:click={() => showClubs = false}>Back to Dashboard</button>
      </div>
      <Clubs authorization={user.authorization} {user} />
    {:else}
      {#if user.is_admin}
        <div class="admin-link">
          <button on:click={() => showAdminPanel = true}>Admin Panel</button>
        </div>
      {/if}
      {#if currentView === 'playground'}
        <Playground 
          username={user.username}
          on:signout={handleSignOut}
          on:settings={() => showSettings = true}
          on:clubs={() => showClubs = true}
          on:switchview={(e) => currentView = e.detail.view}
        />
      {:else}
        <Dashboard 
          bind:spaces={spaces}
          authorization={user.authorization}
          username={user.username}
          on:signout={handleSignOut}
          on:settings={() => showSettings = true}
          on:clubs={() => showClubs = true}
          on:switchview={(e) => currentView = e.detail.view}
        />
      {/if}
    {/if}
  {:else if showAuth}
    <Auth on:authenticated={handleAuthenticated} />
  {:else}
    <Landing on:getstarted={() => showAuth = true} />
  {/if}
</main>

<style>
  main {
    width: 100%;
    min-height: 100vh;
  }

  .nav-header, .admin-link {
    padding: 10px 20px;
    background-color: var(--snow);
    border-bottom: 1px solid var(--smoke);
  }

  .nav-header button, .admin-link button {
    padding: 8px 16px;
    background-color: var(--blue);
    color: var(--white);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .nav-header button:hover, .admin-link button:hover {
    background-color: var(--cyan);
    transform: translateY(-1px);
  }
</style>