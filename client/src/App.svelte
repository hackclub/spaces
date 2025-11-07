<script>
  import { onMount } from 'svelte';
  import Auth from './lib/Auth.svelte';
  import Dashboard from './lib/Dashboard.svelte';
  import AdminPanel from './lib/AdminPanel.svelte';
  import { API_BASE } from './config.js';

  let isAuthenticated = false;
  let user = null;
  let spaces = [];
  let showAdminPanel = false;

  onMount(() => {
    const storedAuth = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('user_data');
    
    if (storedAuth && storedUser) {
      try {
        isAuthenticated = true;
        user = JSON.parse(storedUser);
        loadSpaces();
      } catch (err) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_data');
      }
    }
  });

  function handleAuthenticated(event) {
    const { authorization, username, email, is_admin } = event.detail;
    
    user = {
      authorization,
      username,
      email,
      is_admin
    };
    
    localStorage.setItem('auth_token', authorization);
    localStorage.setItem('user_data', JSON.stringify(user));
    
    isAuthenticated = true;
    loadSpaces();
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
    
    isAuthenticated = false;
    user = null;
    spaces = [];
    
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');
  }
</script>

<main>
  {#if isAuthenticated && user}
    {#if showAdminPanel && user.is_admin}
      <div class="admin-header">
        <button on:click={() => showAdminPanel = false}>Back to Dashboard</button>
      </div>
      <AdminPanel authorization={user.authorization} />
    {:else}
      {#if user.is_admin}
        <div class="admin-link">
          <button on:click={() => showAdminPanel = true}>Admin Panel</button>
        </div>
      {/if}
      <Dashboard 
        bind:spaces={spaces}
        authorization={user.authorization}
        username={user.username}
        on:signout={handleSignOut}
      />
    {/if}
  {:else}
    <Auth on:authenticated={handleAuthenticated} />
  {/if}
</main>

<style>
  main {
    width: 100%;
    min-height: 100vh;
  }

  .admin-header, .admin-link {
    padding: 10px 20px;
    background-color: #f8f9fa;
    border-bottom: 1px solid #ddd;
  }

  .admin-header button, .admin-link button {
    padding: 8px 16px;
    background-color: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .admin-header button:hover, .admin-link button:hover {
    background-color: #0056b3;
  }
</style>