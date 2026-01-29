<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { API_BASE } from '../config.js';

  export let user;

  const dispatch = createEventDispatcher();

  let username = user.username;
  let hackatimeApiKey = user.hackatime_api_key || '';
  
  let newEmail = '';
  let oldEmailCode = '';
  let newEmailCode = '';
  let emailStep = 'input';
  
  let message = '';
  let error = '';
  let emailMessage = '';
  let emailError = '';

  let hackclubMessage = '';
  let hackclubError = '';
  let hackclubLoading = false;

  $: isHackclubLinked = !!user.hackclub_id;
  $: verificationStatus = user.hackclub_verification_status;

  async function linkHackClub() {
    hackclubError = '';
    hackclubMessage = '';
    hackclubLoading = true;

    try {
      const response = await fetch(`${API_BASE}/oauth/hackclub/link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok && data.url) {
        window.location.href = data.url;
      } else {
        hackclubError = data.message || 'Failed to initiate Hack Club linking';
        hackclubLoading = false;
      }
    } catch (err) {
      hackclubError = 'An error occurred. Please try again.';
      console.error(err);
      hackclubLoading = false;
    }
  }

  async function unlinkHackClub() {
    hackclubMessage = '';
    hackclubError = '';
    hackclubLoading = true;

    try {
      const response = await fetch(`${API_BASE}/oauth/unlink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok) {
        hackclubMessage = 'Hack Club account unlinked successfully';
        dispatch('update', { 
          ...user, 
          hackclub_id: null, 
          hackclub_verification_status: null 
        });
      } else {
        hackclubError = data.message || 'Failed to unlink account';
      }
    } catch (err) {
      hackclubError = 'An error occurred. Please try again.';
      console.error(err);
    } finally {
      hackclubLoading = false;
    }
  }

  async function refreshVerification() {
    hackclubMessage = '';
    hackclubError = '';
    hackclubLoading = true;

    try {
      const response = await fetch(`${API_BASE}/oauth/refresh-verification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok) {
        hackclubMessage = 'Verification status refreshed';
        dispatch('update', { 
          ...user, 
          hackclub_verification_status: data.data.verification_status 
        });
      } else {
        hackclubError = data.message || 'Failed to refresh verification';
      }
    } catch (err) {
      hackclubError = 'An error occurred. Please try again.';
      console.error(err);
    } finally {
      hackclubLoading = false;
    }
  }

  function getVerificationStatusText(status) {
    const statusMap = {
      'verified': 'Verified',
      'verified_eligible': 'Verified (Eligible for YSWS)',
      'verified_but_over_18': 'Verified (Over 18)',
      'pending': 'Pending Review',
      'needs_submission': 'Needs Submission',
      'rejected': 'Rejected',
      'not_found': 'Not Found'
    };
    return statusMap[status] || status || 'Unknown';
  }

  function getVerificationStatusClass(status) {
    if (['verified', 'verified_eligible', 'verified_but_over_18'].includes(status)) {
      return 'status-verified';
    }
    if (status === 'pending') return 'status-pending';
    return 'status-unverified';
  }

  async function saveProfile() {
    message = '';
    error = '';
    
    try {
      const response = await fetch(`${API_BASE}/users/update`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          username,
          hackatime_api_key: hackatimeApiKey
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        message = 'Profile updated successfully';
        dispatch('update', data.data);
      } else {
        error = data.message || 'Failed to update profile';
      }
    } catch (err) {
      error = 'An error occurred. Please try again.';
      console.error(err);
    }
  }

  async function startEmailChange() {
    emailMessage = '';
    emailError = '';
    
    if (!newEmail) {
      emailError = 'Please enter a new email address';
      return;
    }
    
    if (newEmail === user.email) {
      emailError = 'New email must be different from current email';
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/users/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: user.email,
          mode: 'update'
        })
      });

      const data = await response.json();

      if (response.ok) {
        emailMessage = 'Verification code sent to your current email (' + user.email + ')';
        emailStep = 'verifyOld';
      } else {
        emailError = data.message || 'Failed to send code';
      }
    } catch (err) {
      emailError = 'An error occurred. Please try again.';
      console.error(err);
    }
  }

  async function verifyOldEmail() {
    emailMessage = '';
    emailError = '';

    if (!oldEmailCode) {
      emailError = 'Please enter the verification code';
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/users/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: newEmail,
          mode: 'update'
        })
      });

      const data = await response.json();

      if (response.ok) {
        emailMessage = 'Verification code sent to your new email (' + newEmail + ')';
        emailStep = 'verifyNew';
      } else {
        emailError = data.message || 'Failed to send code to new email';
      }
    } catch (err) {
      emailError = 'An error occurred. Please try again.';
      console.error(err);
    }
  }

  async function verifyNewEmailAndUpdate() {
    emailMessage = '';
    emailError = '';

    if (!newEmailCode) {
      emailError = 'Please enter the verification code';
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/users/update/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          authorization,
          email: newEmail,
          oldEmailVerificationCode: parseInt(oldEmailCode),
          emailVerificationCode: parseInt(newEmailCode)
        })
      });

      const data = await response.json();

      if (response.ok) {
        emailMessage = 'Email updated successfully';
        newEmail = '';
        oldEmailCode = '';
        newEmailCode = '';
        emailStep = 'input';
        dispatch('update', data.data);
      } else {
        emailError = data.message || 'Failed to update email';
      }
    } catch (err) {
      emailError = 'An error occurred. Please try again.';
      console.error(err);
    }
  }
  
  function cancelEmailChange() {
    emailStep = 'input';
    oldEmailCode = '';
    newEmailCode = '';
    emailMessage = '';
    emailError = '';
  }
</script>

<div class="settings-container">
  <h2>Settings</h2>

  <div class="section">
    <h3>Profile</h3>
    <div class="form-group">
      <label for="username">Username</label>
      <input 
        type="text" 
        id="username" 
        bind:value={username} 
        placeholder="Enter username"
      />
    </div>
    
    <div class="form-group">
      <label for="hackatime">Hackatime API Key</label>
      <input 
        type="text" 
        id="hackatime" 
        bind:value={hackatimeApiKey} 
        placeholder="Enter Hackatime API Key"
      />
      <small>This key is used for integration with Hackatime.</small>
    </div>

    {#if message}<div class="success">{message}</div>{/if}
    {#if error}<div class="error">{error}</div>{/if}

    <button on:click={saveProfile}>Save Profile</button>
  </div>

  <div class="section">
    <h3>Change Email</h3>
    <p>Current Email: <strong>{user.email}</strong></p>
    
    {#if emailStep === 'input'}
      <div class="form-group">
        <label for="newEmail">New Email Address</label>
        <input 
          type="email" 
          id="newEmail" 
          bind:value={newEmail} 
          placeholder="Enter new email"
        />
      </div>
      <button on:click={startEmailChange}>Change Email</button>
    {:else if emailStep === 'verifyOld'}
      <p class="step-info">Step 1 of 2: Verify your current email</p>
      <div class="form-group">
        <label for="oldEmailCode">Verification Code (sent to {user.email})</label>
        <input 
          type="text" 
          id="oldEmailCode" 
          bind:value={oldEmailCode} 
          placeholder="Enter 6-digit code"
        />
      </div>
      <div class="button-group">
        <button on:click={verifyOldEmail}>Continue</button>
        <button class="secondary" on:click={cancelEmailChange}>Cancel</button>
      </div>
    {:else if emailStep === 'verifyNew'}
      <p class="step-info">Step 2 of 2: Verify your new email</p>
      <div class="form-group">
        <label for="newEmailCode">Verification Code (sent to {newEmail})</label>
        <input 
          type="text" 
          id="newEmailCode" 
          bind:value={newEmailCode} 
          placeholder="Enter 6-digit code"
        />
      </div>
      <div class="button-group">
        <button on:click={verifyNewEmailAndUpdate}>Update Email</button>
        <button class="secondary" on:click={cancelEmailChange}>Cancel</button>
      </div>
    {/if}

    {#if emailMessage}<div class="success">{emailMessage}</div>{/if}
    {#if emailError}<div class="error">{emailError}</div>{/if}
  </div>

  <div class="section">
    <h3>Hack Club Account</h3>
    <p class="section-description">
      Link your Hack Club account to access all features. A verified Hack Club account is required to create spaces.
    </p>

    {#if isHackclubLinked}
      <div class="hackclub-status">
        <div class="status-row">
          <span class="status-label">Status:</span>
          <span class="status-badge {getVerificationStatusClass(verificationStatus)}">
            {getVerificationStatusText(verificationStatus)}
          </span>
        </div>
        <div class="status-row">
          <span class="status-label">Hack Club ID:</span>
          <span class="status-value">{user.hackclub_id}</span>
        </div>
      </div>

      {#if !['verified', 'verified_eligible', 'verified_but_over_18'].includes(verificationStatus)}
        <p class="verification-warning">
          Your Hack Club account is not verified. Please complete verification at 
          <a href="https://auth.hackclub.com" target="_blank" rel="noopener noreferrer">auth.hackclub.com</a> 
          to create spaces.
        </p>
      {/if}

      <div class="button-group">
        <button on:click={refreshVerification} disabled={hackclubLoading}>
          {hackclubLoading ? 'Refreshing...' : 'Refresh Status'}
        </button>
        <button class="secondary danger" on:click={unlinkHackClub} disabled={hackclubLoading}>
          Unlink Account
        </button>
      </div>
    {:else}
      <p class="not-linked-message">
        No Hack Club account linked. Link your account to verify your identity and create spaces.
      </p>
      <button class="hackclub-link-button" on:click={linkHackClub}>
        <img src="https://assets.hackclub.com/icon-rounded.svg" alt="" class="hackclub-icon" />
        Link Hack Club Account
      </button>
    {/if}

    {#if hackclubMessage}<div class="success">{hackclubMessage}</div>{/if}
    {#if hackclubError}<div class="error">{hackclubError}</div>{/if}
  </div>
</div>

<style>
  .settings-container {
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
  }

  h2 {
    margin-bottom: 20px;
    color: var(--text);
  }

  h3 {
    margin-bottom: 15px;
    color: var(--text);
    border-bottom: 1px solid var(--smoke);
    padding-bottom: 5px;
  }

  .section {
    background: var(--snow);
    padding: 20px;
    border-radius: 8px;
    margin-bottom: 20px;
    border: 1px solid var(--smoke);
  }

  .form-group {
    margin-bottom: 15px;
  }

  label {
    display: block;
    margin-bottom: 5px;
    font-weight: 500;
    color: var(--text);
  }

  input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--muted);
    border-radius: 4px;
    font-size: 14px;
    background: var(--white);
    color: var(--text);
  }

  input:focus {
    outline: none;
    border-color: var(--blue);
  }

  small {
    display: block;
    margin-top: 5px;
    color: var(--muted);
    font-size: 12px;
  }

  button {
    background: var(--blue);
    color: var(--white);
    border: none;
    padding: 10px 20px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.2s;
  }

  button:hover {
    background: var(--cyan);
  }

  button.secondary {
    background: var(--slate);
    margin-left: 10px;
  }

  button.secondary:hover {
    background: var(--muted);
  }

  .success {
    color: var(--green);
    margin-bottom: 15px;
    padding: 10px;
    background: rgba(51, 214, 166, 0.1);
    border-radius: 4px;
  }

  .error {
    color: var(--red);
    margin-bottom: 15px;
    padding: 10px;
    background: rgba(236, 55, 80, 0.1);
    border-radius: 4px;
  }

  .button-group {
    display: flex;
    align-items: center;
  }

  .step-info {
    font-size: 14px;
    color: var(--muted);
    margin-bottom: 15px;
    font-style: italic;
  }

  .section-description {
    color: var(--muted);
    font-size: 14px;
    margin-bottom: 15px;
  }

  .hackclub-status {
    background: var(--white);
    border: 1px solid var(--smoke);
    border-radius: 6px;
    padding: 15px;
    margin-bottom: 15px;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .status-row:last-child {
    margin-bottom: 0;
  }

  .status-label {
    font-weight: 500;
    color: var(--text);
    min-width: 100px;
  }

  .status-value {
    color: var(--muted);
    font-family: monospace;
    font-size: 13px;
  }

  .status-badge {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .status-verified {
    background: rgba(51, 214, 166, 0.15);
    color: var(--green);
  }

  .status-pending {
    background: rgba(246, 173, 85, 0.15);
    color: var(--orange);
  }

  .status-unverified {
    background: rgba(236, 55, 80, 0.15);
    color: var(--red);
  }

  .verification-warning {
    color: var(--orange);
    font-size: 14px;
    margin-bottom: 15px;
    padding: 10px;
    background: rgba(246, 173, 85, 0.1);
    border-radius: 4px;
  }

  .verification-warning a {
    color: var(--blue);
    text-decoration: underline;
  }

  .not-linked-message {
    color: var(--muted);
    font-size: 14px;
    margin-bottom: 15px;
  }

  .hackclub-link-button {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: var(--white);
    border: 2px solid var(--smoke);
    color: var(--text);
    padding: 10px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: border-color 0.2s, background 0.2s;
  }

  .hackclub-link-button:hover {
    border-color: var(--red);
    background: rgba(236, 55, 80, 0.05);
  }

  .hackclub-icon {
    width: 20px;
    height: 20px;
    border-radius: 4px;
  }

  button.danger {
    background: transparent;
    border: 1px solid var(--red);
    color: var(--red);
  }

  button.danger:hover {
    background: rgba(236, 55, 80, 0.1);
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
