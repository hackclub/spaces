<script>
  import { createEventDispatcher } from 'svelte';
  import { API_BASE, ERROR_MESSAGES } from '../config.js';
  import '../styles/auth.css';

  const dispatch = createEventDispatcher();

  let mode = 'login';
  let authIntent = 'login'; // Track original intent (login/signup) even when in verify mode
  let email = '';
  let username = '';
  let verificationCode = '';
  let error = '';
  let loading = false;
  let message = '';
  let displayMode = 'login';

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
        body: JSON.stringify({ email, mode }),
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
        body: JSON.stringify({ email, verificationCode: parseInt(verificationCode) }),
      });

      const data = await response.json();

      if (response.ok) {
        dispatch('authenticated', {
          authorization: data.data.authorization,
          username: data.data.username,
          email: data.data.email,
          is_admin: data.data.is_admin
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
        body: JSON.stringify({ email, username, verificationCode: parseInt(verificationCode) }),
      });

      const data = await response.json();

      if (response.ok) {
        dispatch('authenticated', {
          authorization: data.data.authorization,
          username: data.data.username,
          email: data.data.email,
          is_admin: data.data.is_admin
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
    error = '';
    message = '';
    verificationCode = '';
    authIntent = newMode; // Update the auth intent
    setTimeout(() => {
      mode = newMode;
    }, 400);
    setTimeout(() => {
      displayMode = newMode;
    }, 800);
  }
</script>



<a href="https://hackclub.com/">
  <img class="flag-banner" src="https://assets.hackclub.com/flag-orpheus-top.svg" alt="Hack Club"/>
</a>

<div class="auth-container" class:signup-mode={mode === 'signup'}>
  <div class="auth-panel auth-form-panel">
    <div class="auth-form-content">
      <div class="auth-header">
        <img class="auth-logo" src="https://icons.hackclub.com/api/icons/ec3750/clubs" alt="Hack Club" />
        <h2 class="auth-title">{displayMode === 'signup' ? 'Join Hack Club Spaces' : 'Welcome Back'}</h2>
        <p class="auth-subtitle">Lorem ipsum dolor sit amet</p>
      </div>

      {#if mode === 'login' || mode === 'signup'}
        <form on:submit|preventDefault={sendVerificationCode}>
          <div class="form-group">
            <label class="form-label" for="email">Email</label>
            <input
              class="form-input"
              id="email"
              type="email"
              bind:value={email}
              required
              placeholder="your@email.com"
            />
          </div>

          <div class="form-group username-field" class:show={mode === 'signup'}>
            <label class="form-label" for="username">Username</label>
            <input
              class="form-input"
              id="username"
              type="text"
              bind:value={username}
              required={mode === 'signup'}
              maxlength="100"
              placeholder="Choose a username"
            />
          </div>

          {#if error}
            <div class="error-message">{error}</div>
          {/if}

          {#if message}
            <div class="success-message">{message}</div>
          {/if}

          <button class="primary-button" type="submit" disabled={loading || !email}>
            {loading ? 'Sending...' : 'Send Verification Code'}
          </button>
        </form>

        <div class="auth-mode-switch">
          {#if mode === 'login'}
            Don't have an account? <span class="auth-mode-link" on:click={() => switchMode('signup')} on:keypress={(e) => e.key === 'Enter' && switchMode('signup')} role="button" tabindex="0">Sign up</span>
          {:else}
            Already have an account? <span class="auth-mode-link" on:click={() => switchMode('login')} on:keypress={(e) => e.key === 'Enter' && switchMode('login')} role="button" tabindex="0">Log in</span>
          {/if}
        </div>
      {:else if mode === 'verify'}
        <p class="info-message">Check your email for the verification code</p>

        <form on:submit|preventDefault={authIntent === 'login' ? handleLogin : handleSignup}>
          <div class="form-group">
            <label class="form-label" for="code">Verification Code</label>
            <input
              class="form-input"
              id="code"
              type="text"
              bind:value={verificationCode}
              required
              placeholder="Enter code from email"
            />
          </div>

          {#if error}
            <div class="error-message">{error}</div>
          {/if}

          <button class="primary-button" type="submit" disabled={loading || !verificationCode}>
            {loading ? 'Verifying...' : authIntent === 'signup' ? 'Complete Sign Up' : 'Login'}
          </button>

          <button class="secondary-button" type="button" on:click={() => switchMode(mode)}>
            Resend Code
          </button>
        </form>
      {/if}
    </div>
  </div>

  <div class="auth-panel auth-image-panel">
    <div class="auth-image-content">
      <img class="auth-image" src="/group-photo.jpg" alt="Hack Club Shipwrecked" />
      <div class="image-caption">
        Hackers at <a href="https://shipwrecked.hackclub.com" target="_blank" rel="noopener noreferrer">Shipwrecked</a>, 2025
      </div>
    </div>
  </div>
</div>
