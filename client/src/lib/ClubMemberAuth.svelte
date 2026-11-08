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
  let verificationCode = '';
  let codeSent = false;
  let error = '';
  let loading = false;

  async function checkMembership() {
    error = '';
    loading = true;

    try {
      const response = await fetch(`${API_BASE}/users/club-member/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, verificationCode: parseInt(verificationCode) }),
      });

      const data = await response.json();

      if (response.ok) {
        const membershipInfo = data.data;
        if (membershipInfo.hasExistingAccount && membershipInfo.hasPasswordAuth) {
          resetToEmail();
          error = 'You already have an account. Log in with your password.';
        } else if (membershipInfo.hasExistingAccount) {
          error = 'This email already has an account using a different login method. Please use email verification or Hack Club OAuth.';
        } else if (membershipInfo.isLeader) {
          error = 'Club leaders sign in with their Hack Club account. Go back and choose Continue with Hack Club.';
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

  async function startSignup() {
    if (!email) {
      error = 'Enter your club email first';
      return;
    }

    loading = true;
    password = '';
    verificationCode = '';
    await sendCode();
    loading = false;

    if (codeSent) {
      step = 'verify';
    }
  }

  async function resendCode() {
    loading = true;
    verificationCode = '';
    await sendCode();
    loading = false;
    step = 'verify';
  }

  async function sendCode() {
    error = '';
    codeSent = false;

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
        codeSent = true;
      } else {
        error = data.message || 'Failed to send verification code';
      }
    } catch (err) {
      error = ERROR_MESSAGES.NETWORK_ERROR;
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
        body: JSON.stringify({ email, username, password, verificationCode: parseInt(verificationCode) }),
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
    verificationCode = '';
    codeSent = false;
    error = '';
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
          {:else}
            Create Account
          {/if}
        </h2>
        <p class="auth-subtitle">
          {#if step === 'email'}
            Sign in with your club email and password
          {:else if step === 'verify'}
            Confirm your email to set up your account
          {:else}
            Set up your account as a club member
          {/if}
        </p>
      </div>

      {#if step === 'email'}
        <form on:submit|preventDefault={handleLogin}>
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

          <button class="primary-button" type="submit" disabled={loading || !email || !password}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>

          <button class="secondary-button" type="button" on:click={startSignup} disabled={loading || !email}>
            First time here? Create an account
          </button>
        </form>

        <div class="auth-mode-switch">
          <span class="auth-mode-link" on:click={goBack} on:keypress={(e) => e.key === 'Enter' && goBack()} role="button" tabindex="0">Back to login options</span>
        </div>
      {/if}

      {#if step === 'verify'}
        <div class="verification-notice">
          <p class="verification-title">Check your email</p>
          <p class="verification-text">We emailed a code to <strong>{email}</strong>. It expires in 5 minutes.</p>
        </div>

        <form on:submit|preventDefault={checkMembership}>
          <div class="form-group">
            <label class="form-label" for="verificationCode">
              Verification code
            </label>
            <input
              class="form-input"
              id="verificationCode"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              bind:value={verificationCode}
              required
              maxlength="6"
              placeholder="6-digit code"
            />
          </div>

          {#if error}
            <div class="error-message">{error}</div>
          {/if}

          <button class="primary-button" type="submit" disabled={loading || !verificationCode}>
            {loading ? 'Checking...' : 'Continue'}
          </button>

          <button class="secondary-button" type="button" on:click={resendCode} disabled={loading}>
            Resend code
          </button>

          <button class="secondary-button" type="button" on:click={resetToEmail}>
            Use different email
          </button>
        </form>
      {/if}

      {#if step === 'signup'}
        <div class="verification-notice">
          <p class="verification-title">Club membership verified</p>
          <p class="verification-text">Your email is on a Hack Club club's member list. Choose a username and password to finish signing up.</p>
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

          <button class="primary-button" type="submit" disabled={loading || !verificationCode || !username || !password || !confirmPassword}>
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>

          <button class="secondary-button" type="button" on:click={resendCode} disabled={loading}>
            Resend code
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
