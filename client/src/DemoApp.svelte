<script>
  import Dashboard from './lib/Dashboard.svelte';

  // Mock user and spaces data for demo
  const mockUser = {
    authorization: 'demo-token',
    username: 'demo-user',
    email: 'demo@example.com'
  };

  const mockSpaces = [
    {
      space_id: 'space-abc123',
      type: 'code-server',
      status: 'running',
      url: 'http://localhost:8080',
      created_at: new Date().toISOString()
    },
    {
      space_id: 'space-def456',
      type: 'blender',
      status: 'stopped',
      url: null,
      created_at: new Date(Date.now() - 86400000).toISOString()
    },
    {
      space_id: 'space-ghi789',
      type: 'kicad',
      status: 'created',
      url: null,
      created_at: new Date(Date.now() - 172800000).toISOString()
    }
  ];

  function handleSignOut() {
    console.log('Sign out clicked');
  }
</script>

<main>
  <Dashboard 
    spaces={mockSpaces}
    authorization={mockUser.authorization}
    username={mockUser.username}
    on:signout={handleSignOut}
  />
</main>

<style>
  main {
    width: 100%;
    min-height: 100vh;
  }
</style>
