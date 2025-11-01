<script>
  import { createEventDispatcher } from 'svelte';
  import { API_BASE, ERROR_MESSAGES } from '../config.js';
  
  const dispatch = createEventDispatcher();
  
  let mode = 'login'; // 'login', 'signup', or 'verify'
  let email = '';
  let username = '';
  let verificationCode = '';
  let error = '';
  let loading = false;
  let message = '';
  
  async function sendVerificationCode() {
    error = '';
    message = '';
    loading = true;
    
    try {
      const response = await fetch(`${API_BASE}/users/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        message = 'Verification code sent to your email!';
        mode = 'verify';
      } else {
        error = data.message || 'Failed to send verification code';
      }
    } catch (err) {
      error = ERROR_MESSAGES.NETWORK_ERROR;
    } finally {
      loading = false;
    }
  }
  
  async function handleLogin() {
    error = '';
    loading = true;
    
    try {
      const response = await fetch(`${API_BASE}/users/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, code: verificationCode }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        dispatch('authenticated', {
          authorization: data.data.authorization,
          username: data.data.username,
          email: data.data.email
        });
      } else {
        error = data.message || 'Login failed';
      }
    } catch (err) {
      error = ERROR_MESSAGES.NETWORK_ERROR;
    } finally {
      loading = false;
    }
  }
  
  async function handleSignup() {
    error = '';
    loading = true;
    
    try {
      const response = await fetch(`${API_BASE}/users/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, username, verificationCode }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        dispatch('authenticated', {
          authorization: data.data.authorization,
          username: data.data.username,
          email: data.data.email
        });
      } else {
        error = data.message || 'Signup failed';
      }
    } catch (err) {
      error = ERROR_MESSAGES.NETWORK_ERROR;
    } finally {
      loading = false;
    }
  }
  
  function switchMode(newMode) {
    mode = newMode;
    error = '';
    message = '';
    verificationCode = '';
  }
</script>

<div class="auth-container">
  <div class="auth-card">
    <h2>Hack Club Spaces</h2>
    
    {#if mode === 'login' || mode === 'signup'}
      <div class="tabs">
        <button 
          class:active={mode === 'login'}
          on:click={() => switchMode('login')}
        >
          Login
        </button>
        <button 
          class:active={mode === 'signup'}
          on:click={() => switchMode('signup')}
        >
          Sign Up
        </button>
      </div>
      
      <form on:submit|preventDefault={sendVerificationCode}>
        <div class="form-group">
          <label for="email">Email</label>
          <input
            id="email"
            type="email"
            bind:value={email}
            required
            placeholder="your@email.com"
          />
        </div>
        
        {#if mode === 'signup'}
          <div class="form-group">
            <label for="username">Username</label>
            <input
              id="username"
              type="text"
              bind:value={username}
              required
              maxlength="100"
              placeholder="Choose a username"
            />
          </div>
        {/if}
        
        {#if error}
          <div class="error">{error}</div>
        {/if}
        
        {#if message}
          <div class="success">{message}</div>
        {/if}
        
        <button type="submit" disabled={loading || !email}>
          {loading ? 'Sending...' : 'Send Verification Code'}
        </button>
      </form>
    {:else if mode === 'verify'}
      <p class="info">Check your email for the verification code</p>
      
      <form on:submit|preventDefault={mode === 'login' ? handleLogin : handleSignup}>
        <div class="form-group">
          <label for="code">Verification Code</label>
          <input
            id="code"
            type="text"
            bind:value={verificationCode}
            required
            placeholder="Enter code from email"
          />
        </div>
        
        {#if error}
          <div class="error">{error}</div>
        {/if}
        
        <button type="submit" disabled={loading || !verificationCode}>
          {loading ? 'Verifying...' : mode === 'signup' ? 'Complete Sign Up' : 'Login'}
        </button>
        
        <button type="button" class="secondary" on:click={() => switchMode(mode)}>
          Resend Code
        </button>
      </form>
    {/if}
  </div>
</div>

<style>
  .auth-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 2rem;
  }
  
  .auth-card {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 2rem;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }
  
  h2 {
    text-align: center;
    margin-bottom: 2rem;
    color: #ec3750;
  }
  
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }
  
  .tabs button {
    flex: 1;
    padding: 0.75rem;
    background: transparent;
    border: 1px solid #646cff;
    color: #646cff;
    cursor: pointer;
    transition: all 0.3s;
  }
  
  .tabs button.active {
    background: #646cff;
    color: white;
  }
  
  .form-group {
    margin-bottom: 1.5rem;
  }
  
  label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
  }
  
  input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #444;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
    font-size: 1rem;
    box-sizing: border-box;
  }
  
  input:focus {
    outline: none;
    border-color: #646cff;
  }
  
  button[type="submit"], .secondary {
    width: 100%;
    padding: 0.75rem;
    margin-top: 0.5rem;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s;
  }
  
  button[type="submit"] {
    background: #646cff;
    border: none;
    color: white;
  }
  
  button[type="submit"]:hover:not(:disabled) {
    background: #535bf2;
  }
  
  button[type="submit"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .secondary {
    background: transparent;
    border: 1px solid #646cff;
    color: #646cff;
  }
  
  .secondary:hover {
    background: rgba(100, 108, 255, 0.1);
  }
  
  .error {
    padding: 0.75rem;
    margin-bottom: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #ef4444;
  }
  
  .success {
    padding: 0.75rem;
    margin-bottom: 1rem;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 8px;
    color: #22c55e;
  }
  
  .info {
    text-align: center;
    margin-bottom: 1.5rem;
    color: #888;
  }
</style>
