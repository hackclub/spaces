<script>
  import { onMount } from 'svelte';
  import Auth from './lib/Auth.svelte';
  import Dashboard from './lib/Dashboard.svelte';

  let isAuthenticated = false;
  let user = null;
  let spaces = [];

  const API_BASE = 'http://localhost:5678/api/v1';

  // Check for stored auth token on mount
  onMount(() => {
    const storedAuth = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('user_data');
    
    if (storedAuth && storedUser) {
      try {
        isAuthenticated = true;
        user = JSON.parse(storedUser);
        loadSpaces();
      } catch (err) {
        // Invalid stored data, clear it
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_data');
      }
    }
  });

  function handleAuthenticated(event) {
    const { authorization, username, email } = event.detail;
    
    user = {
      authorization,
      username,
      email
    };
    
    // Store auth data
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
    
    // Clear local state
    isAuthenticated = false;
    user = null;
    spaces = [];
    
    // Clear stored data
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');
  }
</script>

<main>
  {#if isAuthenticated && user}
    <Dashboard 
      bind:spaces={spaces}
      authorization={user.authorization}
      username={user.username}
      on:signout={handleSignOut}
    />
  {:else}
    <Auth on:authenticated={handleAuthenticated} />
  {/if}
</main>

<style>
  main {
    width: 100%;
    min-height: 100vh;
  }
</style>
