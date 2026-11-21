 <script>
  import { onMount } from "svelte";
  import { API_BASE } from "../config.js";
  import { userData } from "../stores/user.svelte";
  import ExtensionPicker from "./ExtensionPicker.svelte";
  import { themes } from "../themes.js";
  import { currentTheme, setTheme } from "../stores/theme.js";

  const THEME_PREVIEWS = {
    darkGradient: "linear-gradient(135deg, #0a0f1a 0%, #1a2a3a 50%, #0f1a2a 100%)",
    lgbtq: "linear-gradient(135deg, #e40303, #ff8c00, #ffed00, #008026, #24408e, #732982)",
  };

  const LOGIN_METHODS = {
    hackclub: "Hack Club",
    email: "an email code",
    password: "a club password",
  };

  const formatDate = (value) =>
    new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  let limits = null;
  let limitsError = "";
  let sessions = [];
  let sessionsLoading = true;
  let sessionsError = "";
  let sessionsMessage = "";
  let endingSession = null;
  $: otherSessions = sessions.filter((session) => !session.current);

  async function loadLimits() {
    try {
      const response = await fetch(`${API_BASE}/users/limits`, { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      limits = data.data;
    } catch (err) {
      console.error(err);
      limitsError = "Couldn't load your limits.";
    }
  }

  async function loadSessions() {
    try {
      const response = await fetch(`${API_BASE}/users/sessions`, { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      sessions = data.data;
    } catch (err) {
      console.error(err);
      sessionsError = "Couldn't load where you're logged in.";
    }
    sessionsLoading = false;
  }

  async function endSession(id) {
    sessionsError = "";
    sessionsMessage = "";
    endingSession = id;
    try {
      const response = await fetch(`${API_BASE}/users/sessions/${id}`, { method: "DELETE", credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Couldn't sign that session out.");
      sessions = sessions.filter((session) => session.id !== id);
      sessionsMessage = "Signed out.";
    } catch (err) {
      sessionsError = err.message;
    }
    endingSession = null;
  }

  async function endOtherSessions() {
    sessionsError = "";
    sessionsMessage = "";
    endingSession = "others";
    try {
      const response = await fetch(`${API_BASE}/users/sessions/sign-out-others`, { method: "POST", credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Couldn't sign out your other sessions.");
      sessions = sessions.filter((session) => session.current);
      sessionsMessage = data.data.ended === 1 ? "Signed out 1 other session." : `Signed out ${data.data.ended} other sessions.`;
    } catch (err) {
      sessionsError = err.message;
    }
    endingSession = null;
  }

  onMount(() => {
    loadLimits();
    loadSessions();
  });

  let user = userData.user;

  async function refreshUser() {
    await userData.refresh();
    user = userData.user;
  }


  let message = "";
  let error = "";
  let username = user.username || "";
  let savingProfile = false;
  $: usernameChanged = username.trim() !== "" && username.trim() !== user.username;
  $: if (usernameChanged) message = "";

  let hackatimeMessage = "";
  let hackatimeError = "";
  let hackatimeLoading = false;
  $: isHackatimeLinked = !!user.hackatime_linked;

  let hackclubMessage = "";
  let hackclubError = "";
  let hackclubLoading = false;

  $: isHackclubLinked = !!user.hackclub_id;
  $: verificationStatus = user.hackclub_verification_status;

  let githubMessage = "";
  let githubError = "";
  let githubLoading = false;
  $: isGithubLinked = !!user.github_linked;
  $: primaryConnection = (!isHackclubLinked
    ? "hackclub"
    : !isHackatimeLinked && user.hackatime_available
      ? "hackatime"
      : "github");

  const GITHUB_ERRORS = {
    denied: "You cancelled connecting GitHub.",
    invalid_state: "That GitHub link didn't start in this browser. Please try again.",
    state_expired: "Connecting GitHub took too long. Please try again.",
    user_mismatch: "You're logged into a different Spaces account than the one that started connecting. Log in again and retry.",
    token_failed: "GitHub didn't accept the login. Please try again.",
    account_failed: "Couldn't read your GitHub account. Please try again.",
    failed: "Something went wrong connecting GitHub. Please try again.",
  };

  async function connectGithub() {
    githubError = "";
    githubMessage = "";
    githubLoading = true;
    try {
      const response = await fetch(`${API_BASE}/oauth/github/link`, { method: "POST", credentials: "include" });
      const data = await response.json();
      if (response.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      githubError = data.message || "Couldn't start connecting GitHub.";
    } catch (err) {
      console.error(err);
      githubError = "Couldn't start connecting GitHub. Please try again.";
    }
    githubLoading = false;
  }

  async function disconnectGithub() {
    if (!confirm("Disconnect GitHub? Your spaces lose access to your repos right away.")) return;
    githubError = "";
    githubMessage = "";
    githubLoading = true;
    try {
      const response = await fetch(`${API_BASE}/oauth/github/unlink`, { method: "POST", credentials: "include" });
      const data = await response.json();
      if (response.ok) {
        githubMessage = "GitHub disconnected.";
        await refreshUser();
      } else {
        githubError = data.message || "Couldn't disconnect GitHub.";
      }
    } catch (err) {
      console.error(err);
      githubError = "Couldn't disconnect GitHub. Please try again.";
    }
    githubLoading = false;
  }

  let vscodeExtensionsMessage = "";
  let vscodeExtensionsError = "";
  let savingExtensions = false;
  let vscodeExtensions = user.vscode_extensions;
  $: extensionsChanged = (vscodeExtensions || "") !== (user.vscode_extensions || "");
  $: if (extensionsChanged) vscodeExtensionsMessage = "";

  const HACKATIME_ERRORS = {
    denied: "You cancelled connecting Hackatime.",
    invalid_state: "That Hackatime link didn't start in this browser. Please try again.",
    state_expired: "Connecting Hackatime took too long. Please try again.",
    user_mismatch: "You're logged into a different Spaces account than the one that started connecting. Log in again and retry.",
    token_failed: "Hackatime didn't accept the login. Please try again.",
    key_failed: "Couldn't get your API key from Hackatime. Please try again.",
    failed: "Something went wrong connecting Hackatime. Please try again.",
  };

  async function linkHackClub() {
    hackclubError = "";
    hackclubMessage = "";
    hackclubLoading = true;

    try {
      const response = await fetch(`${API_BASE}/oauth/hackclub/link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok && data.url) {
        window.location.href = data.url;
      } else {
        hackclubError = data.message || "Failed to initiate Hack Club linking";
        hackclubLoading = false;
      }
    } catch (err) {
      hackclubError = "An error occurred. Please try again.";
      console.error(err);
      hackclubLoading = false;
    }
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const errorCode = params.get("hackatime_error");
    if (params.get("hackatime") === "linked") {
      hackatimeMessage = "Hackatime connected. New and restarted spaces will track your time.";
    }
    if (errorCode) hackatimeError = HACKATIME_ERRORS[errorCode] || HACKATIME_ERRORS.failed;
    const githubErrorCode = params.get("github_error");
    if (params.get("github") === "linked") {
      githubMessage = "GitHub connected. VS Code spaces you create or start from now on are signed in.";
    }
    if (githubErrorCode) githubError = GITHUB_ERRORS[githubErrorCode] || GITHUB_ERRORS.failed;
    if (params.has("hackatime") || errorCode || params.has("github") || githubErrorCode) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  });

  async function connectHackatime() {
    hackatimeError = "";
    hackatimeMessage = "";
    hackatimeLoading = true;
    try {
      const response = await fetch(`${API_BASE}/oauth/hackatime/link`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (response.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      hackatimeError = data.message || "Failed to start connecting Hackatime";
    } catch (err) {
      console.error(err);
      hackatimeError = "An error occurred. Please try again.";
    }
    hackatimeLoading = false;
  }
  
  async function disconnectHackatime() {
    if (!confirm("Disconnect Hackatime? New spaces will stop tracking your time.")) return;
    hackatimeError = "";
    hackatimeMessage = "";
    hackatimeLoading = true;
    try {
      const response = await fetch(`${API_BASE}/oauth/hackatime/unlink`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (response.ok) {
        hackatimeMessage = "Hackatime disconnected";
        await refreshUser();
      } else {
        hackatimeError = data.message || "Failed to disconnect Hackatime";
      }
    } catch (err) {
      console.error(err);
      hackatimeError = "An error occurred. Please try again.";
    }
    hackatimeLoading = false;
  }

  async function unlinkHackClub() {
    hackclubMessage = "";
    hackclubError = "";
    hackclubLoading = true;

    try {
      const response = await fetch(`${API_BASE}/oauth/unlink`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok) {
        hackclubMessage = "Hack Club account unlinked successfully";
        await refreshUser();
      } else {
        hackclubError = data.message || "Failed to unlink account";
      }
    } catch (err) {
      hackclubError = "An error occurred. Please try again.";
      console.error(err);
    } finally {
      hackclubLoading = false;
    }
  }

  async function refreshVerification() {
    hackclubMessage = "";
    hackclubError = "";
    hackclubLoading = true;

    try {
      const response = await fetch(`${API_BASE}/oauth/refresh-verification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok) {
        hackclubMessage = "Verification status refreshed";
        await refreshUser();
      } else {
        hackclubError = data.message || "Failed to refresh verification";
      }
    } catch (err) {
      hackclubError = "An error occurred. Please try again.";
      console.error(err);
    } finally {
      hackclubLoading = false;
    }
  }

  function getVerificationStatusText(status) {
    const statusMap = {
      verified: "Verified",
      verified_eligible: "Verified (eligible for YSWS)",
      verified_but_over_18: "Verified (over 18)",
      pending: "Pending review",
      needs_submission: "Needs submission",
      rejected: "Rejected",
      not_found: "Not found",
    };
    return statusMap[status] || status || "Unknown";
  }

  function getVerificationStatusClass(status) {
    if (
      ["verified", "verified_eligible", "verified_but_over_18"].includes(status)
    ) {
      return "status-verified";
    }
    if (status === "pending") return "status-pending";
    return "status-unverified";
  }

  async function saveProfile() {
    message = "";
    error = "";
    savingProfile = true;

    try {
      const response = await fetch(`${API_BASE}/users/update`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          username: username.trim(),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        username = data.data.username;
        message = "Username saved.";
        await refreshUser();
      } else {
        error = data.message || "Couldn't save your username.";
      }
    } catch (err) {
      error = "Couldn't save your username. Please try again.";
      console.error(err);
    }
    savingProfile = false;
  }

  async function updateVSCodeSettings() {
    vscodeExtensionsMessage = "";
    vscodeExtensionsError = "";
    savingExtensions = true;

    try {
      const response = await fetch(`${API_BASE}/users/update`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          vscode_extensions: vscodeExtensions,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        vscodeExtensions = data.data.vscode_extensions;
        vscodeExtensionsMessage = "Saved. Your VS Code spaces will install these next time they start.";
        await refreshUser();
      } else {
        vscodeExtensionsError = data.message || "Couldn't save your extensions.";
      }
    } catch (err) {
      vscodeExtensionsError = "Couldn't save your extensions. Please try again.";
      console.error(err);
    }
    savingExtensions = false;
  }
</script>

<div class="settings-page">
  <header class="page-head">
    <h1>Settings</h1>
    <p>Your connections, account, and what goes into your VS Code spaces.</p>
  </header>

  <section class="settings-section" aria-labelledby="connections-heading">
    <div class="section-intro">
      <h2 id="connections-heading">Connections</h2>
      <p>You need a verified Hack Club account to create spaces. Hackatime logs the time you spend coding in them, and GitHub lets your VS Code spaces use your repos.</p>
    </div>

    <div class="settings-panel">
      <div class="row">
        <div class="row-main">
          <img src="https://assets.hackclub.com/icon-rounded.svg" alt="" class="row-icon" />
          <div class="row-text">
            <div class="row-title">
              Hack Club
              {#if isHackclubLinked}
                <span class="badge {getVerificationStatusClass(verificationStatus)}">{getVerificationStatusText(verificationStatus)}</span>
              {/if}
            </div>
            <p class="row-detail">
              {#if isHackclubLinked}
                Linked{#if user.hackclub_id}&nbsp;·&nbsp;<span class="mono">{user.hackclub_id}</span>{/if}
              {:else}
                Not linked. Link it to create spaces.
              {/if}
            </p>
          </div>
        </div>
        <div class="row-actions">
          {#if isHackclubLinked}
            <button class="btn btn-secondary" on:click={refreshVerification} disabled={hackclubLoading}>
              {hackclubLoading ? "Refreshing…" : "Refresh status"}
            </button>
            <button class="btn btn-quiet-danger" on:click={unlinkHackClub} disabled={hackclubLoading}>Unlink</button>
          {:else}
            <button class="btn btn-primary" on:click={linkHackClub} disabled={hackclubLoading}>
              {hackclubLoading ? "Redirecting…" : "Link Hack Club"}
            </button>
          {/if}
        </div>
        {#if isHackclubLinked && !["verified", "verified_eligible", "verified_but_over_18"].includes(verificationStatus)}
          <p class="notice notice-warning row-full">
            Your Hack Club account isn't verified yet, so you can't create spaces. Finish verifying at
            <a href="https://auth.hackclub.com" target="_blank" rel="noopener noreferrer">auth.hackclub.com</a>,
            then refresh your status here.
          </p>
        {/if}
        {#if hackclubMessage}<p class="notice notice-success row-full" role="status">{hackclubMessage}</p>{/if}
        {#if hackclubError}<p class="notice notice-error row-full" role="alert">{hackclubError}</p>{/if}
      </div>

      <div class="row">
        <div class="row-main">
          <span class="row-icon row-icon-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <div class="row-text">
            <div class="row-title">
              Hackatime
              {#if isHackatimeLinked}<span class="badge status-verified">Connected</span>{/if}
            </div>
            <p class="row-detail">
              {#if isHackatimeLinked}
                Your spaces log your coding time automatically.
              {:else if user.hackatime_available}
                Connect it so your spaces log your coding time.
              {:else}
                Connecting Hackatime isn't available yet.
              {/if}
            </p>
          </div>
        </div>
        <div class="row-actions">
          {#if isHackatimeLinked}
            <button class="btn btn-quiet-danger" on:click={disconnectHackatime} disabled={hackatimeLoading}>Disconnect</button>
          {:else if user.hackatime_available}
            <button class={primaryConnection === "hackatime" ? "btn btn-primary" : "btn btn-secondary"} on:click={connectHackatime} disabled={hackatimeLoading}>
              {hackatimeLoading ? "Redirecting…" : "Connect Hackatime"}
            </button>
          {/if}
        </div>
        {#if hackatimeMessage}<p class="notice notice-success row-full" role="status">{hackatimeMessage}</p>{/if}
        {#if hackatimeError}<p class="notice notice-error row-full" role="alert">{hackatimeError}</p>{/if}
      </div>

      <div class="row">
        <div class="row-main">
          <span class="row-icon row-icon-glyph row-icon-github" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" /></svg>
          </span>
          <div class="row-text">
            <div class="row-title">
              GitHub
              {#if isGithubLinked}<span class="badge status-verified">Connected</span>{/if}
            </div>
            <p class="row-detail">
              {#if isGithubLinked}
                Signed in as <strong>@{user.github_username}</strong>. Your VS Code spaces can clone and push to your repos, private ones too. Spaces you share with your club stay signed out.
              {:else if user.github_available}
                Connect it so your VS Code spaces can clone and push to your repos, private ones too.
              {:else}
                Connecting GitHub isn't available yet.
              {/if}
            </p>
          </div>
        </div>
        <div class="row-actions">
          {#if isGithubLinked}
            <button class="btn btn-quiet-danger" on:click={disconnectGithub} disabled={githubLoading}>Disconnect</button>
          {:else if user.github_available}
            <button class={primaryConnection === "github" ? "btn btn-primary" : "btn btn-secondary"} on:click={connectGithub} disabled={githubLoading}>
              {githubLoading ? "Redirecting…" : "Connect GitHub"}
            </button>
          {/if}
        </div>
        {#if githubMessage}<p class="notice notice-success row-full" role="status">{githubMessage}</p>{/if}
        {#if githubError}<p class="notice notice-error row-full" role="alert">{githubError}</p>{/if}
      </div>
    </div>
  </section>

  <section class="settings-section" aria-labelledby="account-heading">
    <div class="section-intro">
      <h2 id="account-heading">Account</h2>
      <p>Your username shows on your spaces. Login codes go to your email.</p>
    </div>

    <div class="settings-panel">
      <form class="row" on:submit|preventDefault={saveProfile}>
        <label class="row-label" for="username">Username</label>
        <div class="field-inline">
          <input type="text" id="username" bind:value={username} autocomplete="username" spellcheck="false" />
          <button type="submit" class="btn btn-primary" disabled={!usernameChanged || savingProfile}>
            {savingProfile ? "Saving…" : "Save"}
          </button>
        </div>
        {#if message}<p class="notice notice-success row-full" role="status">{message}</p>{/if}
        {#if error}<p class="notice notice-error row-full" role="alert">{error}</p>{/if}
      </form>

      <div class="row">
        <span class="row-label" id="email-label">Email</span>
        <p class="value row-full">{user.email}</p>
        <p class="row-detail row-full">
          {#if isHackclubLinked}
            This comes from your Hack Club account. To change it, change it at
            <a href="https://auth.hackclub.com" target="_blank" rel="noopener noreferrer">auth.hackclub.com</a>,
            then log in to Spaces with Hack Club.
          {:else}
            Link your Hack Club account above to use its email instead. You can change that email at
            <a href="https://auth.hackclub.com" target="_blank" rel="noopener noreferrer">auth.hackclub.com</a>.
          {/if}
        </p>
      </div>
    </div>
  </section>

  <section class="settings-section" aria-labelledby="limits-heading">
    <div class="section-intro">
      <h2 id="limits-heading">Limits</h2>
      <p>How many spaces you can have, and how many can run at the same time.</p>
    </div>

    <div class="settings-panel">
      {#if limitsError}
        <div class="row"><p class="notice notice-error row-full" role="alert">{limitsError}</p></div>
      {:else if !limits}
        <div class="row"><p class="row-detail row-full">Loading…</p></div>
      {:else}
        {#each [
          { label: "Spaces", used: limits.spaces, max: limits.max_spaces, full: "Delete a space to make a new one." },
          { label: "Running at once", used: limits.running, max: limits.max_running, full: "Stop a running space to start another." },
        ] as limit}
          <div class="row row-stack">
            <div class="meter-head">
              <span class="row-label">{limit.label}</span>
              <span class="meter-count"><strong>{limit.used}</strong> of {limit.max}</span>
            </div>
            <div
              class="meter"
              class:full={limit.used >= limit.max}
              role="meter"
              aria-label={limit.label}
              aria-valuemin="0"
              aria-valuemax={limit.max}
              aria-valuenow={Math.min(limit.used, limit.max)}
            >
              <span style="width: {Math.min(100, (limit.used / Math.max(limit.max, 1)) * 100)}%"></span>
            </div>
            {#if limit.used >= limit.max}<p class="row-detail">You're at the limit. {limit.full}</p>{/if}
          </div>
        {/each}
      {/if}
    </div>
  </section>

  <section class="settings-section" aria-labelledby="sessions-heading">
    <div class="section-intro">
      <h2 id="sessions-heading">Sessions</h2>
      <p>Everywhere you're logged in to Spaces. Each login lasts a week. If you don't recognise one, sign it out.</p>
    </div>

    <div class="settings-panel">
      {#if sessionsLoading}
        <div class="row"><p class="row-detail row-full">Loading…</p></div>
      {:else}
        {#each sessions as session (session.id)}
          <div class="row">
            <div class="row-text">
              <div class="row-title">
                {session.device || "Unknown device"}
                {#if session.current}<span class="badge status-verified">This device</span>{/if}
              </div>
              <p class="row-detail">
                {#if session.method}Logged in with {LOGIN_METHODS[session.method] || session.method} · {/if}{formatDate(session.created_at)} · ends {formatDate(session.expires_at)}
              </p>
            </div>
            {#if !session.current}
              <div class="row-actions">
                <button class="btn btn-quiet-danger" on:click={() => endSession(session.id)} disabled={endingSession !== null}>
                  {endingSession === session.id ? "Signing out…" : "Sign out"}
                </button>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
      {#if sessionsError || sessionsMessage || otherSessions.length}
        <div class="panel-footer">
          <div class="footer-status">
            {#if sessionsMessage}<span class="text-success" role="status">{sessionsMessage}</span>{/if}
            {#if sessionsError}<span class="text-error" role="alert">{sessionsError}</span>{/if}
          </div>
          {#if otherSessions.length}
            <button class="btn btn-secondary" on:click={endOtherSessions} disabled={endingSession !== null}>
              {endingSession === "others" ? "Signing out…" : "Sign out everywhere else"}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  <section class="settings-section" aria-labelledby="extensions-heading">
    <div class="section-intro">
      <h2 id="extensions-heading">VS Code extensions</h2>
      <p>
        These install in all your VS Code spaces, in the background each time a space is created or started, so they
        can take a minute to show up. Removing one here doesn't uninstall it from spaces that already have it.
      </p>
      <p>
        They come from Open VSX, which has most of the VS Code Marketplace. A few Microsoft ones, like Pylance, C/C++
        and Live Share, aren't on it.
      </p>
    </div>

    <div class="settings-panel">
      <div class="row row-stack">
        <label class="row-label" for="vscode-extensions">Add an extension</label>
        <ExtensionPicker bind:value={vscodeExtensions} />
      </div>
      <div class="panel-footer">
        <div class="footer-status">
          {#if vscodeExtensionsMessage}<span class="text-success" role="status">{vscodeExtensionsMessage}</span>{/if}
          {#if vscodeExtensionsError}<span class="text-error" role="alert">{vscodeExtensionsError}</span>{/if}
          {#if extensionsChanged && !vscodeExtensionsError}<span class="text-muted">You have unsaved changes.</span>{/if}
        </div>
        <button class="btn btn-primary" on:click={updateVSCodeSettings} disabled={!extensionsChanged || savingExtensions}>
          {savingExtensions ? "Saving…" : "Save extensions"}
        </button>
      </div>
    </div>
  </section>

  <section class="settings-section" aria-labelledby="appearance-heading">
    <div class="section-intro">
      <h2 id="appearance-heading">Appearance</h2>
      <p>Pick a theme for Spaces. It's saved in this browser.</p>
    </div>

    <div class="settings-panel">
      <div class="row row-stack">
        <div class="theme-grid" role="radiogroup" aria-labelledby="appearance-heading">
          {#each Object.entries(themes) as [key, theme] (key)}
            <button
              type="button"
              class="theme-card"
              class:selected={$currentTheme === key}
              role="radio"
              aria-checked={$currentTheme === key}
              on:click={() => setTheme(key)}
            >
              <span class="theme-preview" style="background: {THEME_PREVIEWS[key] || theme.colors['--snow']}">
                <span class="theme-preview-panel" style="background: {theme.colors['--white']}; border-color: {theme.colors['--smoke']}">
                  <span class="theme-preview-line" style="background: {theme.colors['--black']}"></span>
                  <span class="theme-preview-line short" style="background: {theme.colors['--muted']}"></span>
                  <span class="theme-preview-button" style="background: {theme.colors['--blue']}"></span>
                </span>
              </span>
              <span class="theme-name">{theme.name}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  .settings-page {
    max-width: 1040px;
    margin: 0 auto;
    padding: 32px 24px 48px;
    color: var(--ui-text);
  }

  .page-head {
    margin-bottom: 8px;
  }

  .page-head h1 {
    margin: 0;
    font-size: 28px;
  }

  .page-head p {
    margin: 6px 0 0;
    font-size: 15px;
    color: var(--ui-text-secondary);
  }

  .settings-section {
    display: grid;
    grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
    gap: 32px 48px;
    padding: 32px 0;
    border-top: 1px solid var(--ui-border-soft);
  }

  .page-head + .settings-section {
    border-top: none;
  }

  .section-intro h2 {
    margin: 0 0 8px;
    font-size: 18px;
  }

  .section-intro p {
    margin: 0 0 10px;
    font-size: 14px;
    line-height: 1.55;
    color: var(--ui-text-secondary);
  }

  .settings-panel {
    min-width: 0;
    background: var(--ui-panel);
    border: 1px solid var(--ui-border);
    border-radius: 10px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    overflow: hidden;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px 16px;
    margin: 0;
    padding: 20px 24px;
  }

  .row + .row {
    border-top: 1px solid var(--ui-border-soft);
  }

  .row-stack {
    grid-template-columns: minmax(0, 1fr);
  }

  .row-full {
    grid-column: 1 / -1;
  }

  .row-main {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }

  .row-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 8px;
  }

  .row-icon-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--ui-accent);
    background: color-mix(in srgb, var(--blue) 14%, transparent);
  }

  .row-icon-github {
    color: var(--ui-text);
    background: color-mix(in srgb, var(--ui-text) 10%, transparent);
  }

  .row-text {
    min-width: 0;
  }

  .row-title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 700;
  }

  .row-detail {
    margin: 2px 0 0;
    font-size: 14px;
    color: var(--ui-text-secondary);
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .row-label {
    grid-column: 1 / -1;
    font-size: 14px;
    font-weight: 700;
  }


  .field-inline {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .field-inline input {
    flex: 1;
  }

  .value {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 15px;
    overflow-wrap: anywhere;
  }

  input {
    width: 100%;
    box-sizing: border-box;
    min-height: 40px;
    padding: 8px 12px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    font-size: 15px;
    background: var(--ui-surface);
    color: var(--ui-text);
  }

  input::placeholder {
    color: var(--ui-text-muted);
  }

  input:focus {
    outline: none;
    border-color: var(--ui-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 25%, transparent);
  }









  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: 0 16px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-family: inherit;
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .btn:focus-visible {
    outline: 2px solid var(--ui-accent);
    outline-offset: 2px;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .btn-primary {
    background: var(--blue);
    color: var(--ui-on-accent);
  }

  .btn-primary:not(:disabled):hover {
    background: color-mix(in srgb, var(--blue) 85%, var(--black));
  }

  .btn-secondary {
    background: transparent;
    border-color: var(--ui-border);
    color: var(--ui-text);
  }

  .btn-secondary:not(:disabled):hover {
    background: var(--ui-hover);
    border-color: var(--ui-text-muted);
  }

  .btn-quiet-danger {
    background: transparent;
    padding: 0 12px;
    color: var(--ui-danger);
  }

  .btn-quiet-danger:not(:disabled):hover {
    background: var(--ui-hover);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
  }

  .status-verified {
    color: var(--ui-success);
    background: color-mix(in srgb, var(--green) 16%, transparent);
  }

  .status-pending {
    color: var(--ui-warning);
    background: color-mix(in srgb, var(--orange) 16%, transparent);
  }

  .status-unverified {
    color: var(--ui-danger);
    background: color-mix(in srgb, var(--red) 14%, transparent);
  }

  .notice {
    margin: 0;
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 14px;
    line-height: 1.5;
  }

  .notice-success {
    color: var(--ui-success);
    background: color-mix(in srgb, var(--green) 12%, transparent);
  }

  .notice-error {
    color: var(--ui-danger);
    background: color-mix(in srgb, var(--red) 10%, transparent);
  }

  .notice a,
  .row-detail a {
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .notice-warning {
    color: var(--ui-text);
    background: color-mix(in srgb, var(--orange) 14%, transparent);
    border-left: 3px solid var(--ui-warning);
  }

  .panel-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 24px;
    border-top: 1px solid var(--ui-border-soft);
    background: var(--ui-surface-alt);
  }

  .footer-status {
    font-size: 14px;
  }

  .text-success {
    color: var(--ui-success);
  }

  .text-error {
    color: var(--ui-danger);
  }

  .text-muted {
    color: var(--ui-text-secondary);
  }

  .meter-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .meter-count {
    font-size: 14px;
    color: var(--ui-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .meter-count strong {
    color: var(--ui-text);
  }

  .meter {
    height: 8px;
    border-radius: 999px;
    background: var(--ui-surface-alt);
    overflow: hidden;
  }

  .meter span {
    display: block;
    height: 100%;
    min-width: 4px;
    border-radius: inherit;
    background: var(--ui-accent);
    transition: width 0.3s ease;
  }

  .meter.full span {
    background: var(--ui-warning);
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 12px;
  }

  .theme-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 6px 10px;
    border: 1px solid var(--ui-border);
    border-radius: 10px;
    background: transparent;
    color: var(--ui-text);
    font-family: inherit;
    font-size: 14px;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .theme-card:hover {
    border-color: var(--ui-text-muted);
  }

  .theme-card:focus-visible {
    outline: 2px solid var(--ui-accent);
    outline-offset: 2px;
  }

  .theme-card.selected {
    border-color: var(--ui-accent);
    box-shadow: 0 0 0 1px var(--ui-accent);
  }

  .theme-preview {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    height: 72px;
    padding: 12px 12px 0;
    border-radius: 6px;
    overflow: hidden;
  }

  .theme-preview-panel {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    height: 100%;
    padding: 8px;
    border: 1px solid;
    border-bottom: none;
    border-radius: 5px 5px 0 0;
  }

  .theme-preview-line {
    display: block;
    width: 70%;
    height: 5px;
    border-radius: 3px;
  }

  .theme-preview-line.short {
    width: 45%;
    opacity: 0.8;
  }

  .theme-preview-button {
    display: block;
    width: 34px;
    height: 10px;
    margin-top: auto;
    margin-bottom: 6px;
    border-radius: 3px;
  }

  .theme-name {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
  }

  .theme-card.selected .theme-name::after {
    content: "✓";
    margin-left: auto;
    color: var(--ui-accent);
  }

  @media (max-width: 860px) {
    .settings-section {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
      padding: 28px 0;
    }
  }

  @media (max-width: 560px) {
    .settings-page {
      padding: 24px 16px 40px;
    }

    .row {
      grid-template-columns: minmax(0, 1fr);
      padding: 18px 16px;
    }

    .row-actions {
      justify-content: flex-start;
    }

    .field-inline {
      flex-wrap: wrap;
    }

    .field-inline input,
    .value {
      flex-basis: 100%;
    }

    .panel-footer {
      flex-direction: column-reverse;
      align-items: stretch;
      padding: 14px 16px;
    }
  }
</style>
