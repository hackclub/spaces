<script>
    import { onMount } from "svelte";
    import Landing from "./lib/Landing.svelte";
    import Auth from "./lib/Auth.svelte";
    import ClubMemberAuth from "./lib/ClubMemberAuth.svelte";
    import Dashboard from "./lib/Dashboard.svelte";
    import Playground from "./lib/Playground.svelte";
    import AdminPanel from "./lib/AdminPanel.svelte";
    import ThemeSwitcher from "./lib/ThemeSwitcher.svelte";
    import Settings from "./lib/Settings.svelte";
    import Clubs from "./lib/Clubs.svelte";
    import { API_BASE } from "./config.js";
    import { applyTheme, currentTheme } from "./stores/theme.js";
    import { get } from "svelte/store";

    import { userData } from "./stores/user.svelte";

    let isAuthenticated = false;
    let spaces = [];
    let showAdminPanel = false;
    let showSettings = false;
    let showClubs = false;
    let showAuth = false;
    let showClubMemberAuth = false;
    let currentView = "spaces";

    onMount(async () => {
        applyTheme(get(currentTheme));

        isAuthenticated = await userData.refresh();
    });

    async function handleAuthenticated(event) {
        isAuthenticated = await userData.refresh();
        loadSpaces();
    }

    async function handleUserUpdate(event) {
        await userData.refresh();
    }

    async function loadSpaces() {
        if (!userData.user) return;

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

    async function handleSignOut() {
        try {
            await fetch(`${API_BASE}/users/signout`, {
                method: "POST",
                credentials: "include",
            });
        } catch (err) {
            console.error("Sign out error:", err);
        }

        isAuthenticated = false;
        spaces = [];
    }
</script>

<main class:has-theme-switcher={isAuthenticated && userData.user}>
    {#if isAuthenticated && userData.user}
        <ThemeSwitcher />
        {#if showAdminPanel && userData.user.is_admin}
            <div class="nav-header">
                <button on:click={() => (showAdminPanel = false)}
                    >Back to Dashboard</button
                >
            </div>
            <AdminPanel />
        {:else if showSettings}
            <div class="nav-header">
                <button on:click={() => (showSettings = false)}
                    >Back to Dashboard</button
                >
            </div>
            <Settings on:update={handleUserUpdate} />
        {:else if showClubs}
            <div class="nav-header">
                <button on:click={() => (showClubs = false)}
                    >Back to Dashboard</button
                >
            </div>
            <Clubs />
        {:else}
            {#if userData.user.is_admin}
                <div class="admin-link">
                    <button on:click={() => (showAdminPanel = true)}
                        >Admin Panel</button
                    >
                </div>
            {/if}
            {#if currentView === "playground"}
                <Playground
                    username={userData.user.username}
                    on:signout={handleSignOut}
                    on:settings={() => (showSettings = true)}
                    on:clubs={() => (showClubs = true)}
                    on:switchview={(e) => (currentView = e.detail.view)}
                />
            {:else}
                <Dashboard
                    bind:spaces
                    username={userData.user.username}
                    on:signout={handleSignOut}
                    on:settings={() => (showSettings = true)}
                    on:clubs={() => (showClubs = true)}
                    on:switchview={(e) => (currentView = e.detail.view)}
                />
            {/if}
        {/if}
    {:else if showClubMemberAuth}
        <ClubMemberAuth
            on:authenticated={handleAuthenticated}
            on:back={() => {
                showClubMemberAuth = false;
                showAuth = true;
            }}
        />
    {:else if showAuth}
        <Auth
            on:authenticated={handleAuthenticated}
            on:clubmember={() => {
                showAuth = false;
                showClubMemberAuth = true;
            }}
        />
    {:else}
        <Landing on:getstarted={() => (showAuth = true)} />
    {/if}
</main>

<style>
    main {
        width: 100%;
        min-height: 100vh;
        box-sizing: border-box;
    }

    main.has-theme-switcher {
        padding-bottom: 76px;
    }

    .nav-header,
    .admin-link {
        padding: 10px 20px;
        background-color: var(--snow);
        border-bottom: 1px solid var(--smoke);
    }

    .nav-header button,
    .admin-link button {
        padding: 8px 16px;
        background-color: var(--blue);
        color: var(--white);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .nav-header button:hover,
    .admin-link button:hover {
        background-color: var(--cyan);
        transform: translateY(-1px);
    }
</style>
