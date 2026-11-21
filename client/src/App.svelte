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
    $: showSettings = url === "/settings" || url.startsWith("/settings?");

    function navigate(to) {
        if (to !== window.location.pathname + window.location.search) {
            history.pushState(null, "", to);
        }
        url = to;
    }
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

        if (isAuthenticated && !showSettings && /(^|[#&])(hackatime|github)(_error)?=/.test(window.location.hash)) {
            history.replaceState(null, "", `/settings${window.location.hash}`);
            url = "/settings";
        }
    });

    async function handleAuthenticated(event) {
        isAuthenticated = await userData.refresh();
        loadSpaces();
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
                <button on:click={() => navigate("/")}
                    >Dashboard</button
                >
            </div>
            <Settings />
        {:else if showClubs}
            <div class="nav-header">
                <button on:click={() => (showClubs = false)}
                    >Dashboard</button
                >
            </div>
            <Clubs />
        {:else}
            <Dashboard
                bind:spaces
                username={userData.user.username}
                isAdmin={userData.user.is_admin}
                on:signout={handleSignOut}
                on:settings={() => navigate("/settings")}
                on:clubs={() => (showClubs = true)}
                on:admin={() => navigate("/admin")}
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

    .nav-header {
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

</style>
