<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { API_BASE } from '../config.js';

  export let user;
  export let authorization;

  const dispatch = createEventDispatcher();

  let username = user.username;
  let hackatimeApiKey = user.hackatime_api_key || '';
  
  let newEmail = '';
  let verificationCode = '';
  let emailStep = 'input'; // input, verify
  
  let message = '';
  let error = '';
  let emailMessage = '';
  let emailError = '';

  async function saveProfile() {
    message = '';
    error = '';
    
    try {
      const response = await fetch(`${API_BASE}/users/update`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization
        },
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

  async function sendEmailCode() {
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
          email: newEmail,
          mode: 'update' // Mode doesn't really matter for send logic, but good for logging if added
        })
      });

      const data = await response.json();

      if (response.ok) {
        emailMessage = 'Verification code sent to ' + newEmail;
        emailStep = 'verify';
      } else {
        emailError = data.message || 'Failed to send code';
      }
    } catch (err) {
      emailError = 'An error occurred. Please try again.';
      console.error(err);
    }
  }

  async function verifyEmailChange() {
    emailMessage = '';
    emailError = '';

    if (!verificationCode) {
      emailError = 'Please enter the verification code';
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/users/verify-email-change`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization
        },
        body: JSON.stringify({
          newEmail,
          verificationCode
        })
      });

      const data = await response.json();

      if (response.ok) {
        emailMessage = 'Email updated successfully';
        newEmail = '';
        verificationCode = '';
        emailStep = 'input';
        dispatch('update', data.data);
      } else {
        emailError = data.message || 'Failed to verify email';
      }
    } catch (err) {
      emailError = 'An error occurred. Please try again.';
      console.error(err);
    }
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
      <button on:click={sendEmailCode}>Send Verification Code</button>
    {:else}
      <div class="form-group">
        <label for="verificationCode">Verification Code</label>
        <input 
          type="text" 
          id="verificationCode" 
          bind:value={verificationCode} 
          placeholder="Enter 6-digit code"
        />
      </div>
      <div class="button-group">
        <button on:click={verifyEmailChange}>Verify & Update</button>
        <button class="secondary" on:click={() => emailStep = 'input'}>Cancel</button>
      </div>
    {/if}

    {#if emailMessage}<div class="success">{emailMessage}</div>{/if}
    {#if emailError}<div class="error">{emailError}</div>{/if}
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
</style>
