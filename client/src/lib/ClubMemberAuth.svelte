<script>
  import { createEventDispatcher } from 'svelte';
  import { API_BASE, ERROR_MESSAGES } from '../config.js';
  import '../styles/auth.css';

  const dispatch = createEventDispatcher();

  let step = 'email';
  let email = '';
  let username = '';
  let password = '';
  let confirmPassword = '';
  let error = '';
  let loading = false;
  let membershipInfo = null;

  async function checkMembership() {
    error = '';
    loading = true;

    try {
      const response = await fetch(`${API_BASE}/users/club-member/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        membershipInfo = data.data;
        if (membershipInfo.hasExistingAccount && membershipInfo.hasPasswordAuth) {
          step = 'login';
        } else if (membershipInfo.hasExistingAccount) {
          error = 'This email already has an account using a different login method. Please use email verification or Hack Club OAuth.';
        } else {
          step = 'signup';
        }
      } else {
        error = data.message || 'No club membership found for this email';
      }
    } catch (err) {
      error = ERROR_MESSAGES.NETWORK_ERROR;
    } finally {
      loading = false;
    }
  }

  async function handleSignup() {
    error = '';

    if (password !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }

    if (password.length < 8) {
      error = 'Password must be at least 8 characters';
      return;
    }

    loading = true;

    try {
      const response = await fetch(`${API_BASE}/users/club-member/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        dispatch('authenticated', {
          username: data.data.username,
          email: data.data.email,
          is_admin: data.data.is_admin,
          hackatime_api_key: data.data.hackatime_api_key,
          hackclub_id: data.data.hackclub_id,
          hackclub_verification_status: data.data.hackclub_verification_status
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

  async function handleLogin() {
    error = '';
    loading = true;

    try {
      const response = await fetch(`${API_BASE}/users/club-member/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        dispatch('authenticated', {
          username: data.data.username,
          email: data.data.email,
          is_admin: data.data.is_admin,
          hackatime_api_key: data.data.hackatime_api_key,
          hackclub_id: data.data.hackclub_id,
          hackclub_verification_status: data.data.hackclub_verification_status
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

  function goBack() {
    dispatch('back');
  }

  function resetToEmail() {
    step = 'email';
    password = '';
    confirmPassword = '';
    error = '';
    membershipInfo = null;
  }
</script>

<a href="https://hackclub.com/">
  <img class="flag-banner" src="https://assets.hackclub.com/flag-orpheus-top.svg" alt="Hack Club"/>
</a>

<div class="auth-container">
  <div class="auth-panel auth-form-panel">
    <div class="auth-form-content">
      <div class="auth-header">
        <img class="auth-logo" src="https://icons.hackclub.com/api/icons/ec3750/flag" alt="Hack Club" />
        <h2 class="auth-title">
          {#if step === 'email'}
            Club Member Login
          {:else if step === 'signup'}
            Create Account
          {:else}
            Welcome Back
          {/if}
        </h2>
        <p class="auth-subtitle">
          {#if step === 'email'}
            Sign in with your club email and password
          {:else if step === 'signup'}
            Set up your account as a club member
          {:else}
            Log in to your club member account
          {/if}
        </p>
      </div>

      {#if step === 'email'}
        <form on:submit|preventDefault={checkMembership}>
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
              placeholder="your-club@email.com"
            />
          </div>

          {#if error}
            <div class="error-message">{error}</div>
          {/if}

          <button class="primary-button" type="submit" disabled={loading || !email}>
            {loading ? 'Checking...' : 'Continue'}
          </button>
        </form>

        <div class="auth-mode-switch">
          <span class="auth-mode-link" on:click={goBack} on:keypress={(e) => e.key === 'Enter' && goBack()} role="button" tabindex="0">Back to login options</span>
        </div>
      {/if}

      {#if step === 'signup'}
        <div class="verification-notice">
          <p class="verification-title">Club membership verified</p>
          <p class="verification-text">You are {membershipInfo?.isLeader ? 'a leader' : 'a member'} of <strong>{membershipInfo?.clubName}</strong></p>
        </div>

        <form on:submit|preventDefault={handleSignup}>
          <div class="form-group">
            <label class="form-label" for="username">
              Username
            </label>
            <input
              class="form-input"
              id="username"
              type="text"
              bind:value={username}
              required
              maxlength="100"
              placeholder="Choose a username"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="password">
              Password
            </label>
            <input
              class="form-input"
              id="password"
              type="password"
              bind:value={password}
              required
              minlength="8"
              placeholder="At least 8 characters"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="confirmPassword">
              Confirm Password
            </label>
            <input
              class="form-input"
              id="confirmPassword"
              type="password"
              bind:value={confirmPassword}
              required
              placeholder="Confirm your password"
            />
          </div>

          {#if error}
            <div class="error-message">{error}</div>
          {/if}

          <button class="primary-button" type="submit" disabled={loading || !username || !password || !confirmPassword}>
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>

          <button class="secondary-button" type="button" on:click={resetToEmail}>
            Use different email
          </button>
        </form>
      {/if}

      {#if step === 'login'}
        <form on:submit|preventDefault={handleLogin}>
          <div class="form-group">
            <label class="form-label" for="email-display">
              Email
            </label>
            <input
              class="form-input"
              id="email-display"
              type="email"
              value={email}
              disabled
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="password">
              Password
            </label>
            <input
              class="form-input"
              id="password"
              type="password"
              bind:value={password}
              required
              placeholder="Enter your password"
            />
          </div>

          {#if error}
            <div class="error-message">{error}</div>
          {/if}

          <button class="primary-button" type="submit" disabled={loading || !password}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>

          <button class="secondary-button" type="button" on:click={resetToEmail}>
            Use different email
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
