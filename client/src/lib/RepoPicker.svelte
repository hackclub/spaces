<script>
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";

  export let value = "";
  export let repos = [];
  export let loading = false;
  export let disabled = false;
  export let placeholder = "";
  export let id = "spaceRepo";
  export let describedby = "";

  const dispatch = createEventDispatcher();
  const listId = `${id}-options`;
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const UNITS = [
    ["year", 365 * 24 * 3600],
    ["month", 30 * 24 * 3600],
    ["week", 7 * 24 * 3600],
    ["day", 24 * 3600],
    ["hour", 3600],
    ["minute", 60],
  ];

  let open = false;
  let active = -1;
  let input;
  let listEl;
  let listStyle = "";

  const portal = (node) => {
    (node.closest("dialog") || document.body).appendChild(node);
    return { destroy: () => node.remove() };
  };

  function place() {
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < 220 && above > below;
    const maxHeight = Math.max(140, Math.min(340, upward ? above : below));
    listStyle = [
      `left: ${rect.left}px`,
      `width: ${rect.width}px`,
      `max-height: ${maxHeight}px`,
      upward ? `bottom: ${window.innerHeight - rect.top + 6}px` : `top: ${rect.bottom + 6}px`,
    ].join("; ");
  }

  const reposition = () => {
    if (open) place();
  };

  onMount(() => {
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  });

  const pushedAgo = (stamp) => {
    if (!stamp) return "";
    const seconds = (new Date(stamp).getTime() - Date.now()) / 1000;
    for (const [unit, size] of UNITS) {
      if (Math.abs(seconds) >= size) return `Pushed ${relative.format(Math.round(seconds / size), unit)}`;
    }
    return "Pushed just now";
  };

  const searchText = (text) => {
    const trimmed = (text || "").trim().toLowerCase();
    const fromLink = trimmed.match(/github\.com\/([^/\s]+\/[^/\s?#]+)/);
    return (fromLink ? fromLink[1] : trimmed).replace(/\.git$/, "");
  };

  $: query = searchText(value);
  $: exact = repos.some((repo) => repo.name.toLowerCase() === query);
  $: matches = !query || exact
    ? repos
    : repos.filter((repo) => repo.name.toLowerCase().includes(query) || repo.description.toLowerCase().includes(query));
  $: hasList = repos.length > 0 || loading;
  $: showList = open && hasList && !disabled;
  $: if (active >= matches.length) active = matches.length - 1;

  async function openList() {
    if (!hasList || disabled) return;
    place();
    open = true;
    await tick();
    place();
  }

  function close() {
    open = false;
    active = -1;
  }

  function choose(repo) {
    value = repo.name;
    dispatch("input");
    close();
  }

  function scrollActive() {
    requestAnimationFrame(() => listEl?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }));
  }

  function onKeydown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openList();
      if (matches.length) active = (active + 1) % matches.length;
      scrollActive();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openList();
      if (matches.length) active = active <= 0 ? matches.length - 1 : active - 1;
      scrollActive();
    } else if (event.key === "Enter" && showList && matches[active]) {
      event.preventDefault();
      choose(matches[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  }

  function onInput() {
    active = -1;
    openList();
    dispatch("input");
  }

  function toggle() {
    if (open) {
      close();
    } else {
      openList();
      input?.focus();
    }
  }

  onDestroy(close);
</script>

<div class="repo-picker" class:has-toggle={hasList}>
  <input
    bind:this={input}
    class="form-input"
    {id}
    type="text"
    inputmode="url"
    autocomplete="off"
    spellcheck="false"
    role={hasList ? "combobox" : undefined}
    aria-expanded={hasList ? showList : undefined}
    aria-controls={hasList ? listId : undefined}
    aria-autocomplete={hasList ? "list" : undefined}
    aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
    aria-describedby={describedby || undefined}
    {disabled}
    {placeholder}
    bind:value
    on:input={onInput}
    on:focus={openList}
    on:click={openList}
    on:blur={close}
    on:keydown={onKeydown}
  />

  {#if hasList}
    <button
      type="button"
      class="repo-toggle"
      tabindex="-1"
      aria-label={showList ? "Hide your repos" : "Show your repos"}
      {disabled}
      on:mousedown|preventDefault={toggle}
    >
      <svg class:flipped={showList} viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4.427 7.427l3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z" /></svg>
    </button>
  {/if}

  {#if showList}
    <ul class="repo-list" id={listId} role="listbox" aria-label="Your GitHub repos" style={listStyle} bind:this={listEl} use:portal on:mousedown|preventDefault>
      {#if loading && !repos.length}
        <li class="repo-note">Loading your repos…</li>
      {:else if !matches.length}
        <li class="repo-note">None of your repos match. You can still paste a link to any public repo.</li>
      {:else}
        {#each matches as repo, index (repo.name)}
          <li
            id={`${listId}-${index}`}
            class="repo-option"
            class:active={index === active}
            role="option"
            aria-selected={index === active}
            on:mousedown|preventDefault={() => choose(repo)}
            on:mousemove={() => (active = index)}
          >
            <span class="repo-icon" aria-hidden="true">
              {#if repo.private}
                <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8.25 3.5h-8.5a.25.25 0 0 0-.25.25v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25ZM10.5 6V4a2.5 2.5 0 1 0-5 0v2Z" /></svg>
              {:else}
                <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" /></svg>
              {/if}
            </span>
            <span class="repo-text">
              <span class="repo-name">
                <span class="repo-owner">{repo.name.split("/")[0]}/</span><strong>{repo.name.split("/").slice(1).join("/")}</strong>
                {#if repo.private}<span class="repo-badge">Private</span>{/if}
              </span>
              {#if repo.description}<span class="repo-description">{repo.description}</span>{/if}
              {#if repo.pushed_at}<span class="repo-pushed">{pushedAgo(repo.pushed_at)}</span>{/if}
            </span>
            {#if repo.name.toLowerCase() === query}
              <span class="repo-chosen" aria-label="Selected">✓</span>
            {/if}
          </li>
        {/each}
      {/if}
    </ul>
  {/if}
</div>

<style>
  .repo-picker {
    position: relative;
  }

  .repo-picker.has-toggle :global(.form-input) {
    padding-right: 48px;
  }

  .repo-toggle {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-secondary);
    cursor: pointer;
  }

  .repo-toggle:hover:not(:disabled) {
    background: var(--ui-hover);
    color: var(--ui-text);
  }

  .repo-toggle svg {
    transition: transform 0.15s ease;
  }

  .repo-toggle svg.flipped {
    transform: rotate(180deg);
  }

  .repo-list {
    position: fixed;
    z-index: 1500;
    box-sizing: border-box;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
    list-style: none;
    background: var(--ui-surface);
    border: 1px solid var(--ui-border);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
  }

  .repo-option {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px;
    border-radius: 6px;
    cursor: pointer;
  }

  .repo-option.active {
    background: var(--ui-hover);
  }

  .repo-icon {
    flex-shrink: 0;
    display: inline-flex;
    margin-top: 2px;
    color: var(--ui-text-secondary);
  }

  .repo-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .repo-name {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0 6px;
    font-size: 15px;
    color: var(--ui-text);
    overflow-wrap: anywhere;
  }

  .repo-owner {
    color: var(--ui-text-secondary);
    margin-right: -6px;
  }

  .repo-name strong {
    font-weight: 700;
  }

  .repo-badge {
    padding: 1px 8px;
    border: 1px solid var(--ui-border);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    color: var(--ui-text-secondary);
  }

  .repo-description {
    font-size: 13px;
    line-height: 1.4;
    color: var(--ui-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .repo-pushed {
    font-size: 12px;
    color: var(--ui-text-muted);
  }

  .repo-chosen {
    flex-shrink: 0;
    font-weight: 700;
    color: var(--ui-accent);
  }

  .repo-note {
    padding: 12px 10px;
    font-size: 14px;
    color: var(--ui-text-secondary);
  }
</style>
