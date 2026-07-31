<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { API_BASE, ERROR_MESSAGES } from "../config.js";
  import "../styles/dashboard.css";
  import { currentTheme } from "../stores/theme.js";
  import { themes } from "../themes.js";
  import FlagIcon from "../assets/flag.svg?raw";
  import ShareWithClubToggle from "./ShareWithClubToggle.svelte";
  import { userData } from "../stores/user.svelte";

  export let spaces = [];
  export let username = "";

  const dispatch = createEventDispatcher();

  let showCreateForm = false;
  let newSpaceType = "code-server";
  let newSpacePassword = "";
  let newSpaceHomeDir = "";
  let error = "";
  let loading = false;
  let actionLoading = {};
  let actionError = {};
  let dropdownOpen = false;
  let showPassword = false;
  let clubData = null;
  let spaceShareStatus = {};
  let searchQuery = '';
  let filterType = 'all';
  let filterStatus = 'all';
  let copyFeedback={};
  let viewMode = "grid";

  onMount(() => {
    loadClubData();
    loadSpaces();
  });

  async function loadClubData() {
    try {
      const response = await fetch(`${API_BASE}/clubs/me`, {
        credentials: "include",
      });
      const data = await response.json();
      if (response.ok && data.success && data.data.club) {
        clubData = data.data.club;
        loadSpaceShareStatuses();
      }
    } catch (err) {
      console.error("Failed to load club data:", err);
    }
  }

  async function loadSpaceShareStatuses() {
    for (const space of spaces) {
      try {
        const response = await fetch(
          `${API_BASE}/spaces/${space.id}/share/status`,
          {
            credentials: "include",
          },
        );
        const data = await response.json();
        if (response.ok && data.success) {
          spaceShareStatus[space.id] = data.data;
          spaceShareStatus = spaceShareStatus;
        }
      } catch (err) {
        console.error("Failed to load share status:", err);
      }
    }
  }

  const spaceTypes = [
    {
      value: "code-server",
      label: "VS Code Server",
      description: "Web-based code editor",
    },
    {
      value: "blender",
      label: "Blender 3D",
      description: "3D modeling and animation",
    },
    { value: "kicad", label: "KiCad", description: "PCB design software" },
    { value: "freecad", label: "FreeCAD", description: "CAD software" },
  ];
  function formatLastOpened(date){
    if(!date) return 'Never';
    const diff = Date.now()-new Date(date).getTime();
    const mins = Math.floor(diff/60000);
    if (mins<2) return 'Just now';
    if (mins<60) return `${mins}m ago`;
    const hours = Math.floor(mins/60);
    if (hours<24) return `${hours}h ago`;
    const days = Math.floor(hours/24)
    if (days<7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  }
  async function toggleFavorite(spaceId) {
    try {
      const response = await fetch(`${API_BASE}/spaces/${spaceId}/favorite`,{
        method:'POST',
        credentials:'include'
      });
      const data = await response.json();
    if (data.success){
      spaces = spaces.map(s =>
        s.id === spaceId? {...s,is_favorite:data.is_favorite}:s
      );
    }
    } catch(err){
      console.error('Failed to toggle favorite:',err);
    }
  }

  async function createSpace() {
    error = "";
    loading = true;

    try {
      const body = { type: newSpaceType };
      if (
        newSpaceType !== "kicad" &&
        newSpaceType !== "blender" &&
        newSpaceType !== "freecad"
      ) {
        body.password = newSpacePassword;
        if (newSpaceHomeDir.trim()) {
          body.homeDir = newSpaceHomeDir.trim();
        }
      }

      const response = await fetch(`${API_BASE}/spaces/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        showCreateForm = false;
        newSpacePassword = "";
        newSpaceHomeDir = "";
        await loadSpaces();
      } else {
        if (
          response.status === 403 &&
          data.error?.includes("Maximum space limit")
        ) {
          error = data.error;
        } else {
          error = data.error || ERROR_MESSAGES.CREATE_FAILED;
        }
      }
    } catch (err) {
      error = ERROR_MESSAGES.NETWORK_ERROR;
    } finally {
      loading = false;
    }
  }

  async function loadSpaces() {
    try {
      const response = await fetch(`${API_BASE}/spaces/list`, {
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok) {
        spaces = data.spaces;
      }
    } catch (err) {
      console.error("Failed to load spaces:", err);
    }
  }

  async function startSpace(spaceId) {
    actionLoading[spaceId] = "starting";
    actionError[spaceId] = "";
    actionLoading = actionLoading;
    actionError = actionError;

    try {
      const response = await fetch(`${API_BASE}/spaces/start/${spaceId}`, {
        method: "POST",
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok) {
        await loadSpaces();
      } else {
        if (data.error?.includes("only have one space running")) {
          actionError[spaceId] = data.error;
        } else {
          actionError[spaceId] = data.error || ERROR_MESSAGES.START_FAILED;
        }
        actionError = actionError;
      }
    } catch (err) {
      actionError[spaceId] = ERROR_MESSAGES.NETWORK_ERROR;
      actionError = actionError;
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }

  async function stopSpace(spaceId) {
    actionLoading[spaceId] = "stopping";
    actionError[spaceId] = "";
    actionLoading = actionLoading;
    actionError = actionError;

    try {
      const response = await fetch(`${API_BASE}/spaces/stop/${spaceId}`, {
        method: "POST",
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok) {
        await loadSpaces();
      } else {
        actionError[spaceId] = data.error || ERROR_MESSAGES.STOP_FAILED;
        actionError = actionError;
      }
    } catch (err) {
      actionError[spaceId] = ERROR_MESSAGES.NETWORK_ERROR;
      actionError = actionError;
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }

  async function refreshStatus(spaceId) {
    actionLoading[spaceId] = "refreshing";
    actionError[spaceId] = "";
    actionLoading = actionLoading;
    actionError = actionError;

    try {
      const response = await fetch(`${API_BASE}/spaces/status/${spaceId}`, {
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok) {
        await loadSpaces();
      } else {
        actionError[spaceId] = data.error || ERROR_MESSAGES.STATUS_FAILED;
        actionError = actionError;
      }
    } catch (err) {
      actionError[spaceId] = ERROR_MESSAGES.NETWORK_ERROR;
      actionError = actionError;
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }

  async function deleteSpace(spaceId) {
    if (
      !confirm(
        "Are you sure you want to delete this space? This action cannot be undone.",
      )
    ) {
      return;
    }

    actionLoading[spaceId] = "deleting";
    actionError[spaceId] = "";
    actionLoading = actionLoading;
    actionError = actionError;

    try {
      const response = await fetch(`${API_BASE}/spaces/delete/${spaceId}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok) {
        await loadSpaces();
      } else {
        actionError[spaceId] = data.error || "Failed to delete space";
        actionError = actionError;
      }
    } catch (err) {
      actionError[spaceId] = ERROR_MESSAGES.NETWORK_ERROR;
      actionError = actionError;
    } finally {
      delete actionLoading[spaceId];
      actionLoading = actionLoading;
    }
  }
  async function copySpaceUrl(spaceId,access_url) {
    if(!access_url)return;
    const showSuccess = () => {
      copyFeedback = {
        ...copyFeedback,
        [spaceId]:true,
      };
      setTimeout(()=>{
        const{[spaceId]:removed,...rest}=copyFeedback;
        copyFeedback = rest;
      },1500);
    };
      try {
      const el = document.createElement("textarea");
      el.value = access_url;
      document.body.appendChild(el);
      el.select();

      const copied = document.execCommand("copy");

      document.body.removeChild(el);

      if (copied) {
        showSuccess();
      }
    } catch (fallbackErr) {
      console.error("Failed to copy URL:", fallbackErr);
    }
  }


  function handleSignOut() {
    dispatch("signout");
  }

  function getStatusClass(status) {
    switch (status?.toLowerCase()) {
      case "running":
        return "status-running";
      case "stopped":
        return "status-stopped";
      case "created":
        return "status-created";
      default:
        return "status-unknown";
    }
  }

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
  }

  function selectSpaceType(value) {
    newSpaceType = value;
    dropdownOpen = false;
  }

  $: selectedType =
    spaceTypes.find((type) => type.value === newSpaceType) || spaceTypes[0];

  $: logoColor = (() => {
    const theme = themes[$currentTheme];
    if (theme && theme.colors["--red"]) {
      return theme.colors["--red"];
    }
    return "#ec3750";
  })();

$: sortedSpaces = [...spaces].sort((a, b) => {
  if (a.is_favorite === b.is_favorite) return 0;
  return a.is_favorite ? -1 : 1;
});

$: uniqueTypes = [
  ...new Set(spaces.map(s => s.type).filter(Boolean))
].sort();

$: filteredSpaces = sortedSpaces.filter(space => {
  const q = searchQuery.trim().toLowerCase();
  const statusText = space.running ? 'running' : 'stopped';

  const matchesSearch =
    !q ||
    String(space.id).includes(q) ||
    space.type?.toLowerCase().includes(q) ||
    statusText.includes(q);

  const matchesType =
    filterType === 'all' ||
    space.type?.toLowerCase() === filterType.toLowerCase();

  const matchesStatus =
    filterStatus === 'all' ||
    statusText === filterStatus;

  return matchesSearch && matchesType && matchesStatus;
});

  function togglePasswordVisibility() {
    showPassword = !showPassword;
  }

  function handleSettings() {
    dispatch("settings");
  }

  function handleClubs() {
    dispatch("clubs");
  }

  function handleSwitchToPlayground() {
    dispatch("switchview", { view: "playground" });
  }
</script>

<div class="dashboard">
  <header class="dashboard-header">
    <div class="header-content">
      <div class="dashboard-logo" style="color: {logoColor}">
        {@html FlagIcon}
      </div>
      <div>
        <h1 class="dashboard-title">Hack Club Spaces</h1>
        <p class="welcome-text">Welcome, {username}!</p>
      </div>
    </div>
    <div class="header-actions">
      <div class="view-switcher">
        <button class="view-tab active">Spaces</button>
        <button class="view-tab" on:click={handleSwitchToPlayground}
          >Playground</button
        >
      </div>
      <button class="clubs-button" on:click={handleClubs}>My Club</button>
      <button class="settings-button" on:click={handleSettings}>Settings</button
      >
      <button class="signout-button" on:click={handleSignOut}>Sign Out</button>
    </div>
  </header>

  <div class="dashboard-content">
    <div class="actions-bar">
      <div class="left-actions">
        <div class="view-switcher">

          <button class="view-tab"
          class:active={ viewMode === "grid"}
          on:click={()=>viewMode="grid"}>Grid</button>
          <button class="view-tab"
          class:active={ viewMode === "list"}
          on:click={()=>viewMode="list"}>List</button>
        </div>
      </div>
      <div class="right-actions">
  <button
    class="btn-primary"
    on:click={() => (showCreateForm = !showCreateForm)}
  >
    {showCreateForm ? "Cancel" : "+ Create New Space"}
  </button>

  <button
    class="btn-secondary"
    on:click={loadSpaces}
  >
    Refresh
  </button>
</div>
    </div>

    {#if showCreateForm}
      <div class="create-form">
        <h3 class="create-form-title">Create New Space</h3>

        {#if newSpaceType == "code-server" && !userData.user.hackatime_api_key}
          <div class="warn-message">
            Add your Hackatime API key in the settings to track time spent
            coding in Spaces!
          </div>
        {/if}

        <div class="form-group">
          <label class="form-label" for="type">Space Type</label>
          <div class="custom-select">
            <button
              type="button"
              class="select-trigger"
              class:open={dropdownOpen}
              on:click={toggleDropdown}
            >
              {selectedType.label}
            </button>
            <div class="select-arrow" class:open={dropdownOpen}></div>
            <div class="select-dropdown" class:open={dropdownOpen}>
              {#each spaceTypes as spaceType}
                <div
                  class="select-option"
                  class:selected={spaceType.value === newSpaceType}
                  on:click={() => selectSpaceType(spaceType.value)}
                  on:keypress={(e) =>
                    e.key === "Enter" && selectSpaceType(spaceType.value)}
                  role="option"
                  tabindex="0"
                  aria-selected={spaceType.value === newSpaceType}
                >
                  <div class="option-label">{spaceType.label}</div>
                  <div class="option-description">{spaceType.description}</div>
                </div>
              {/each}
            </div>
          </div>
        </div>

        {#if newSpaceType !== "kicad" && newSpaceType !== "blender" && newSpaceType !== "freecad"}
          <div class="form-group">
            <label class="form-label" for="password"
              >Password (min. 8 characters)</label
            >
            <p class="password-info">
              This password will be needed to access the space. Please pick a
              secure password, you cannot change it later.
            </p>
            <div class="password-input-wrapper">
              {#if showPassword}
                <input
                  class="form-input password-input"
                  id="password"
                  type="text"
                  bind:value={newSpacePassword}
                  required
                  placeholder="Set a password for this space"
                />
              {:else}
                <input
                  class="form-input password-input"
                  id="password"
                  type="password"
                  bind:value={newSpacePassword}
                  required
                  placeholder="Set a password for this space"
                />
              {/if}
              <button
                type="button"
                class="password-toggle"
                on:click={togglePasswordVisibility}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {#if showPassword}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    fill="currentColor"
                    viewBox="0 0 256 256"
                  >
                    <path
                      d="M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79A134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z"
                    ></path>
                  </svg>
                {:else}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    fill="currentColor"
                    viewBox="0 0 256 256"
                  >
                    <path
                      d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"
                    ></path>
                  </svg>
                {/if}
              </button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="homeDir">Home Directory (optional)</label>
            <p class="password-info">
              The home folder name. Must live under
              <code>/config</code> so it persists. Defaults to
              <code>/config/workspace</code>. If you are using hackatime, you should put different folder names for each project.
            </p>
            <input
              class="form-input"
              id="homeDir"
              type="text"
              bind:value={newSpaceHomeDir}
              placeholder="/config/workspace"
            />
          </div>
        {:else}
          <div class="form-group"></div>
        {/if}

        {#if error}
          <div class="error-message">{error}</div>
        {/if}

        <button
          class="btn-primary"
          on:click={createSpace}
          disabled={loading ||
            (newSpaceType !== "kicad" &&
              newSpaceType !== "blender" &&
              newSpaceType !== "freecad" &&
              (!newSpacePassword || newSpacePassword.length < 8))}
        >
          {loading ? "Creating..." : "Create Space"}
        </button>
      </div>
    {/if}

  <div class="spaces-list">
  <h3 class="section-title">Your Spaces</h3>

  <div class="search-bar">
    <input
      class="search-input"
      type="text"
      placeholder="Search by ID, type, or status..."
      bind:value={searchQuery}
    />

    <select class="filter-select" bind:value={filterType}>
      <option value="all">All Types</option>
      {#each uniqueTypes as t}
        <option value={t}>{t}</option>
      {/each}
    </select>

    <select class="filter-select" bind:value={filterStatus}>
      <option value="all">All Status</option>
      <option value="running">Running</option>
      <option value="stopped">Stopped</option>
    </select>

    {#if searchQuery || filterType !== "all" || filterStatus !== "all"}
      <button
        class="clear-btn"
        on:click={() => {
          searchQuery = "";
          filterType = "all";
          filterStatus = "all";
        }}
      >
        Clear
      </button>
    {/if}
  </div>

  {#if spaces.length === 0}
    <div class="empty-state">
      <p>No spaces yet. Create your first space to get started!</p>
    </div>
  {:else if filteredSpaces.length === 0}
    <div class="empty-state">
      <p>No spaces match your search.</p>
    </div>
  {:else}
    <div class="spaces-grid"
    class:list-view={viewMode === "list"}>
      {#each filteredSpaces as space}
        <div class="space-card"
         class:list-mode={viewMode === "list"}>
          <div class="space-header">
            <h4 class="space-type">{space.type}</h4>
            <div class="space-header-right">
              <button class="fav-btn" class:active={space.is_favorite}
              on:click={()=> toggleFavorite(space.id)}
              title={space.is_favorite? 'Remove from favourites':'Add to Favourites'}>
                  {#if space.is_favorite}
                  <svg fill-rule="evenodd" clip-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="1.414" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet" fill="currentColor" width="18" height="18"><path d="M14.6549 6.72548C15.2051 5.61061 16.7949 5.61061 17.3451 6.72548L19.1777 10.4387C19.3962 10.8814 19.8185 11.1883 20.3071 11.2593L24.4049 11.8547C25.6353 12.0335 26.1265 13.5455 25.2363 14.4133L22.271 17.3037C21.9175 17.6483 21.7562 18.1448 21.8396 18.6313L22.5396 22.7126C22.7498 23.938 21.4637 24.8724 20.3632 24.2939L16.698 22.367C16.261 22.1372 15.739 22.1372 15.302 22.367L11.6368 24.2939C10.5363 24.8724 9.2502 23.938 9.46036 22.7126L10.1604 18.6314C10.2438 18.1448 10.0825 17.6483 9.72896 17.3037L6.76375 14.4133C5.87347 13.5455 6.36474 12.0335 7.59507 11.8547L11.6929 11.2593C12.1815 11.1883 12.6038 10.8814 12.8223 10.4387L14.6549 6.72548Z"/></svg>
                  {:else}
                    <svg fill-rule="evenodd" clip-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="1.414" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet" fill="currentColor" width="18" height="18"><path d="M16 8.51912L14.6158 11.3239C14.1059 12.3569 13.1205 13.0729 11.9805 13.2385L8.88523 13.6883L11.125 15.8715C11.9499 16.6756 12.3263 17.8341 12.1316 18.9695L11.6028 22.0522L14.3713 20.5967C15.3909 20.0607 16.609 20.0607 17.6287 20.5967L20.3971 22.0522L19.8684 18.9695C19.6737 17.8341 20.0501 16.6756 20.875 15.8715L23.1147 13.6883L20.0195 13.2385C18.8795 13.0729 17.894 12.3569 17.3842 11.3239L16 8.51912ZM17.3451 6.72549C16.7949 5.61063 15.2051 5.61063 14.6549 6.7255L12.8223 10.4387C12.6038 10.8815 12.1814 11.1883 11.6929 11.2593L7.59505 11.8548C6.36472 12.0335 5.87346 13.5455 6.76373 14.4133L9.72894 17.3037C10.0825 17.6483 10.2438 18.1448 10.1603 18.6314L9.46035 22.7126C9.25018 23.938 10.5363 24.8724 11.6368 24.2939L15.302 22.367C15.739 22.1372 16.261 22.1372 16.698 22.367L20.3632 24.2939C21.4636 24.8724 22.7498 23.938 22.5396 22.7126L21.8396 18.6314C21.7562 18.1448 21.9175 17.6483 22.271 17.3037L25.2362 14.4133C26.1265 13.5455 25.6352 12.0335 24.4049 11.8548L20.3071 11.2593C19.8185 11.1883 19.3962 10.8815 19.1777 10.4387L17.3451 6.72549Z"/></svg>
                  {/if}
            </button>
            <span class="status-badge {getStatusClass(space.status)}">
              {space.status || "Unkown"}
            </span>
            </div>
          </div>

          <div class="space-info">
            <p><strong>Space ID:</strong> {space.id}</p>
            <p>
              <strong>Created:</strong>
              {new Date(space.created_at).toLocaleString()}
            </p>
            <p><strong>Last opened:</strong> {formatLastOpened(space.last_opened_at)}</p>

          </div>

          <div class="space-share-section">
            <ShareWithClubToggle
              spaceId={space.id}
              hasClub={!!clubData}
              initialShared={spaceShareStatus[space.id]?.shared || false}
              clubName={clubData?.displayName || clubData?.name || ""}
            />
          </div>

          {#if actionError[space.id]}
            <div class="error-message small">
              {actionError[space.id]}
            </div>
          {/if}

          <div class="space-actions">
            {#if actionLoading[space.id]}
              <button disabled class="action-btn">
                {actionLoading[space.id]}...
              </button>
            {:else}
              {#if space.running || space.status?.toLowerCase() === "running"}
                {#if space.access_url}
                  <a
                    href={space.access_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="action-btn open"
                  >
                    Open
                  </a>

                  <button
                    type="button"
                    class="action-btn copy"
                    on:click={() => copySpaceUrl(space.id, space.access_url)}
                    title="Copy space URL"
                  >
                    {#if copyFeedback[space.id]}
                      <svg 
                       class="copy-icon"
                       viewBox='0 0 32 32'
                       fill = "currentColor"
                       aria-label="Copied">
                        <path d="M10.707 14.293C10.317 14.683 10.317 15.317 10.707 15.707L15.293 20.293C15.683 20.683 16.317 20.683 16.707 20.293L28.293 8.70699C28.683 8.31699 28.683 7.68299 28.293 7.29299L27.957 6.95699C27.567 6.56699 26.933 6.56699 26.543 6.95699L16 17.5L12.457 13.957C12.067 13.567 11.433 13.567 11.043 13.957L10.707 14.293V14.293Z"/>
                      </svg>
                      {:else}
                      <svg
                        class="copy-icon"
                        viewBox='0 0 32 32'
                       fill = "currentColor"
                       aria-label="Copy Url">
                      <path d="M10 14C10 13.448 10.448 13 11 13H22C22.552 13 23 13.448 23 14C23 14.552 22.552 15 22 15H11C10.448 15 10 14.552 10 14Z"/>
                      <path d="M10 18C10 17.448 10.448 17 11 17H22C22.552 17 23 17.448 23 18C23 18.552 22.552 19 22 19H11C10.448 19 10 18.552 10 18Z"/>
                      <path d="M10 22C10 21.448 10.448 21 11 21H19C19.552 21 20 21.448 20 22C20 22.552 19.552 23 19 23H11C10.448 23 10 22.552 10 22Z"/>
                      <path d="M17.96 3.93119C17.9648 3.95466 17.9674 3.97763 17.9679 4H20C20.552 4 21 4.448 21 5V7C21 7.552 20.552 8 20 8H12C11.448 8 11 7.552 11 7V5C11 4.448 11.448 4 12 4H14.0321C14.224 3.02719 15.034 2.31519 16 2.31519C16.965 2.31519 17.776 3.02719 17.96 3.93119Z"/>
                      <path d="M6 17C6 9.14915 6.42432 6.39217 10 5.45705V7C10 7.18211 10.0244 7.35854 10.07 7.52622C9.563 7.71106 9.28679 7.92979 9.099 8.155C8.779 8.539 8.458 9.249 8.255 10.752C8.046 12.283 8 14.274 8 17C8 19.725 8.046 21.717 8.255 23.248C8.458 24.751 8.779 25.461 9.099 25.845C9.375 26.176 9.842 26.493 10.952 26.709C12.164 26.95 13.744 27 16 27C18.256 27 19.836 26.95 21.048 26.709C22.158 26.493 22.625 26.176 22.901 25.845C23.221 25.461 23.542 24.751 23.744 23.248C23.954 21.717 24 19.725 24 17C24 14.274 23.954 12.283 23.744 10.752C23.542 9.249 23.221 8.539 22.901 8.155C22.7132 7.92979 22.437 7.71106 21.93 7.52622C21.9756 7.35854 22 7.18211 22 7V5.45705C25.5757 6.39217 26 9.14915 26 17C26 28 25.167 29 16 29C6.833 29 6 28 6 17Z"/>
                      </svg>
                      
                      
                    {/if}
                  </button>
                {/if}

                <button
                  type="button"
                  class="action-btn stop"
                  on:click={() => stopSpace(space.id)}
                >
                  Stop
                </button>

              {:else}

                <button
                  class="action-btn start"
                  on:click={() => startSpace(space.id)}
                >
                  Start
                </button>

              {/if}

              <button
                class="action-btn refresh"
                on:click={() => refreshStatus(space.id)}
                title="Refresh status"
              >
                <svg
                  class="refresh-icon"
                  viewBox="0 0 32 32"
                  aria-label="Refresh"
                  
                >
                  <path d="M20.726,14.162c-0.776,-2.415 -3.04,-4.162 -5.713,-4.162c-3.314,0 -6,2.686 -6,6c0,3.314 2.686,6 6,6c2.063,0 3.883,-1.041 4.962,-2.626c0.333,-0.489 0.988,-0.707 1.497,-0.406c0.437,0.26 0.611,0.814 0.342,1.246c-1.411,2.273 -3.929,3.786 -6.801,3.786c-4.418,0 -8,-3.582 -8,-8c0,-4.418 3.582,-8 8,-8c3.53,0 6.525,2.286 7.588,5.458c0.278,-0.429 0.537,-0.848 0.736,-1.175c0.108,-0.178 0.196,-0.324 0.258,-0.428l0.042,-0.07l0.029,-0.05l0.018,-0.03l0.005,-0.008l0.001,-0.002c0.279,-0.476 0.892,-0.636 1.368,-0.357c0.477,0.279 0.636,0.892 0.357,1.369l-0.001,0.001l-0.001,0.002l-0.005,0.009l-0.02,0.034c-0.017,0.028 -0.043,0.072 -0.075,0.125l-0.062,0.105l-0.015,0.025l-0.084,0.139c-0.033,0.055 -0.069,0.114 -0.107,0.176c-0.222,0.365 -0.528,0.86 -0.849,1.35c-0.32,0.49 -0.676,1.006 -0.978,1.389c-0.157,0.198 -0.336,0.402 -0.482,0.54c-0.084,0.077 -0.217,0.181 -0.316,0.243c-0.103,0.062 -0.357,0.201 -0.695,0.178c-0.202,-0.013 -0.369,-0.08 -0.447,-0.113c-0.083,-0.035 -0.195,-0.091 -0.283,-0.141c-0.164,-0.092 -0.372,-0.224 -0.575,-0.363c-0.399,-0.272 -0.884,-0.633 -1.337,-0.98c-0.453,-0.348 -0.892,-0.697 -1.214,-0.954c-0.162,-0.13 -0.296,-0.239 -0.389,-0.314l-0.108,-0.088l-0.029,-0.024l-0.007,-0.006l-0.002,-0.001l-0.001,-0.001c-0.427,-0.35 -0.489,-0.98 -0.139,-1.407c0.35,-0.428 0.98,-0.489 1.407,-0.139l0.036,0.029l0.104,0.085c0.091,0.074 0.221,0.178 0.379,0.305c0.317,0.255 0.74,0.59 1.181,0.928c0.143,0.11 0.285,0.218 0.425,0.323Z"/>
                </svg>
              </button>

              <button
                class="action-btn delete"
                on:click={() => deleteSpace(space.id)}
              >
                Delete
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>  
  </div>
</div>
