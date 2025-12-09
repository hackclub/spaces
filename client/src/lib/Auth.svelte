<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { API_BASE, ERROR_MESSAGES } from '../config.js';
  import '../styles/auth.css';

  const dispatch = createEventDispatcher();

  let mode = 'login';
  let authIntent = 'login';
  let email = '';
  let username = '';
  let verificationCode = '';
  let error = '';
  let loading = false;
  let message = '';
  let displayMode = 'login';

  onMount(() => {
    const hash = window.location.hash.startsWith('#') 
      ? window.location.hash.slice(1) 
      : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    const queryParams = new URLSearchParams(window.location.search);
    
    if (hashParams.get('oauth_success') === 'true') {
      const userData = hashParams.get('user_data');
      if (userData) {
        try {
          const parsed = JSON.parse(decodeURIComponent(userData));
          dispatch('authenticated', {
            authorization: parsed.authorization,
            username: parsed.username,
            email: parsed.email,
            is_admin: parsed.is_admin,
            hackatime_api_key: parsed.hackatime_api_key,
            hackclub_id: parsed.hackclub_id,
            hackclub_verification_status: parsed.hackclub_verification_status
          });
          window.history.replaceState({}, '', window.location.pathname);
        } catch (e) {
          console.error('Failed to parse OAuth user data:', e);
        }
      }
    }
    
    const oauthError = queryParams.get('error');
    if (oauthError) {
      const errorMessages = {
        'oauth_denied': 'Authorization was denied. Please try again.',
        'oauth_invalid_state': 'Invalid session. Please try again.',
        'oauth_state_expired': 'Session expired. Please try again.',
        'oauth_token_failed': 'Failed to complete authorization. Please try again.',
        'oauth_hackclub_already_linked': 'This Hack Club account is already linked to another user.',
        'oauth_callback_failed': 'Something went wrong. Please try again.'
      };
      error = errorMessages[oauthError] || 'OAuth error. Please try again.';
      window.history.replaceState({}, '', window.location.pathname);
    }
  });

  function loginWithHackClub() {
    window.location.href = `${API_BASE}/oauth/hackclub/login`;
  }

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
        if (response.status === 404 && mode === 'login') {
          error = "We couldn't find your account. Let's create one!";
          setTimeout(() => {
            error = '';
            authIntent = 'signup';
            setTimeout(() => {
              mode = 'signup';
            }, 400);
            setTimeout(() => {
              displayMode = 'signup';
            }, 800);
          }, 1500);
        } else {
          error = data.message || 'Failed to send verification code';
        }
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
          is_admin: data.data.is_admin,
          hackatime_api_key: data.data.hackatime_api_key
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
          is_admin: data.data.is_admin,
          hackatime_api_key: data.data.hackatime_api_key
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

<div class="auth-container" class:signup-mode={authIntent === 'signup'} class:verify-mode={mode === 'verify' && authIntent === 'login'}>
  <div class="auth-panel auth-form-panel">
    <div class="auth-form-content">
      <div class="auth-header">
        <img class="auth-logo" src="https://icons.hackclub.com/api/icons/ec3750/flag" alt="Hack Club" />
        <h2 class="auth-title">{displayMode === 'signup' ? 'Join Hack Club Spaces' : 'Welcome Back'}</h2>
        <p class="auth-subtitle">Build amazing projects in the cloud</p>
      </div>

      {#if mode === 'login' || mode === 'signup'}
        <form on:submit|preventDefault={sendVerificationCode}>
          <div class="form-group">
            <label class="form-label" for="email">
              Email
            </label>
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
            <label class="form-label" for="username">
              Username
            </label>
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

          <button class="primary-button" type="submit" disabled={loading || !email || (mode === 'signup' && !username)}>
            {loading ? 'Sending...' : 'Send Verification Code'}
          </button>

          <div class="divider">
            <span>or</span>
          </div>

          <button class="hackclub-button" type="button" on:click={loginWithHackClub}>
            <img src="https://assets.hackclub.com/icon-rounded.svg" alt="" class="hackclub-icon" />
            Continue with Hack Club
          </button>
        </form>

        <div class="auth-mode-switch">
          {#if mode === 'login'}
            Don't have an account? <span class="auth-mode-link" on:click={() => switchMode('signup')} on:keypress={(e) => e.key === 'Enter' && switchMode('signup')} role="button" tabindex="0">Sign up</span>
          {:else}
            Already have an account? <span class="auth-mode-link" on:click={() => switchMode('login')} on:keypress={(e) => e.key === 'Enter' && switchMode('login')} role="button" tabindex="0">Log in</span>
          {/if}
        </div>
      {/if}

      {#if authIntent === 'signup'}
        <div class="verification-code-section" class:show={mode === 'verify'}>
            <div class="verification-notice">
              <p class="verification-title">Check your email</p>
              <p class="verification-text">We sent a verification code to <strong>{email}</strong></p>
            </div>

            <form on:submit|preventDefault={handleSignup}>
              <div class="form-group">
                <label class="form-label" for="code">
                  Verification Code
                </label>
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
                {loading ? 'Verifying...' : 'Complete Sign Up'}
              </button>

              <button class="secondary-button" type="button" on:click={sendVerificationCode}>
                Resend Code
              </button>
            </form>
        </div>
      {/if}

      {#if mode === 'verify' && authIntent === 'login'}
        <div class="verification-notice">
          <p class="verification-title">Check your email</p>
          <p class="verification-text">We sent a verification code to <strong>{email}</strong></p>
        </div>

        <form on:submit|preventDefault={handleLogin}>
          <div class="form-group">
            <label class="form-label" for="code">
              Verification Code
            </label>
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
            {loading ? 'Verifying...' : 'Login'}
          </button>

          <button class="secondary-button" type="button" on:click={() => switchMode('login')}>
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
