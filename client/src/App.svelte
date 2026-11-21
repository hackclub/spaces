<script>
    import { onMount } from "svelte";
    import Landing from "./lib/Landing.svelte";
    import Auth from "./lib/Auth.svelte";
    import ClubMemberAuth from "./lib/ClubMemberAuth.svelte";
    import Dashboard from "./lib/Dashboard.svelte";
    import AdminPanel from "./lib/AdminPanel.svelte";
    import Settings from "./lib/Settings.svelte";
    import Clubs from "./lib/Clubs.svelte";
    import { API_BASE } from "./config.js";
    import { applyTheme, currentTheme } from "./stores/theme.js";
    import { get } from "svelte/store";
    import HackatimePrompt from "./lib/HackatimePrompt.svelte";

    import { userData } from "./stores/user.svelte";

    let isAuthenticated = false;
    let spaces = [];
    let url = window.location.pathname + window.location.search;
    $: showAdminPanel = url === "/admin" || url.startsWith("/admin/") || url.startsWith("/admin?");

    function navigate(to) {
        if (to !== window.location.pathname + window.location.search) {
            history.pushState(null, "", to);
        }
        url = to;
    }
    let showSettings = false;
    let showClubs = false;
    let showAuth = false;
    let showClubMemberAuth = false;
    let hackatimePromptClosed = false;

    onMount(async () => {
        applyTheme(get(currentTheme));

        window.addEventListener("popstate", () => {
            url = window.location.pathname + window.location.search;
        });

        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const response = await originalFetch(...args);
            if (response.status === 401 && isAuthenticated) {
                isAuthenticated = false;
                spaces = [];
            }
            return response;
        };

        isAuthenticated = await userData.refresh();

        if (isAuthenticated && /(^|[#&])(hackatime|github)(_error)?=/.test(window.location.hash)) {
            showSettings = true;
        }
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

<main>
    {#if isAuthenticated && userData.user}
        {#if userData.user.hackatime_prompt && !hackatimePromptClosed && !showSettings}
            <HackatimePrompt on:close={() => (hackatimePromptClosed = true)} />
        {/if}
        {#if showAdminPanel && userData.user.is_admin}
            <div class="nav-header">
                <button on:click={() => navigate("/")}
                    >Dashboard</button
                >
            </div>
            {#key userData.user}
                <AdminPanel {url} {navigate} />
            {/key}
        {:else if showSettings}
            <div class="nav-header">
                <button on:click={() => (showSettings = false)}
                    >Dashboard</button
                >
            </div>
            <Settings on:update={handleUserUpdate} />
        {:else if showClubs}
            <div class="nav-header">
                <button on:click={() => (showClubs = false)}
                    >Dashboard</button
                >
            </div>
            <Clubs />
        {:else}
            {#if userData.user.is_admin}
                <div class="admin-link">
                    <button on:click={() => navigate("/admin")}
                        >Admin Panel</button
                    >
                </div>
            {/if}
            <Dashboard
                bind:spaces
                username={userData.user.username}
                on:signout={handleSignOut}
                on:settings={() => (showSettings = true)}
                on:clubs={() => (showClubs = true)}
            />
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
        position: relative;
        width: 100%;
        min-height: 100vh;
        box-sizing: border-box;
    }

    .nav-header,
    .admin-link {
        padding: 10px 20px;
        background-color: var(--snow);
        border-bottom: 1px solid var(--smoke);
    }

    .nav-header button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        margin-left: -10px;
        background: transparent;
        color: var(--ui-text);
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: background-color 0.15s ease;
    }

    .nav-header button::before {
        content: "←";
    }

    .nav-header button:hover {
        background: var(--ui-hover);
    }

    .nav-header button:focus-visible {
        outline: 2px solid var(--blue);
        outline-offset: 2px;
    }

    .admin-link button {
        padding: 8px 16px;
        background-color: var(--blue);
        color: var(--white);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .admin-link button:hover {
        background-color: var(--cyan);
        transform: translateY(-1px);
    }
</style>
