<script>
  import { onMount, onDestroy } from "svelte";

  export let value = null;
  export let max = 30;

  const OPEN_VSX = "https://open-vsx.org";
  const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
  const listId = `extension-results-${Math.random().toString(36).slice(2, 8)}`;

  let items = [];
  let query = "";
  let results = [];
  let searching = false;
  let searchError = "";
  let open = false;
  let active = -1;
  let timer;
  let controller;

  const parse = (text) => [...new Set((text || "").split(/\r?\n/).map((id) => id.trim()).filter(Boolean))];
  const key = (id) => id.toLowerCase();
  const idOf = (extension) => `${extension.namespace}.${extension.name}`;

  $: added = new Set(items.map((item) => key(item.id)));
  $: full = items.length >= max;

  function commit() {
    value = items.length ? items.map((item) => item.id).join("\n") : null;
  }

  async function describe(id) {
    const dot = id.indexOf(".");
    try {
      const response = await fetch(`${OPEN_VSX}/api/${encodeURIComponent(id.slice(0, dot))}/${encodeURIComponent(id.slice(dot + 1))}`);
      if (response.status === 404) return { missing: true };
      if (!response.ok) return {};
      const data = await response.json();
      return { name: data.displayName || data.name, icon: data.files?.icon || null };
    } catch {
      return {};
    }
  }

  async function load(id) {
    const info = await describe(id);
    items = items.map((item) => (key(item.id) === key(id) ? { ...item, ...info, loading: false } : item));
  }

  onMount(() => {
    items = parse(value).map((id) => ({ id, loading: true }));
    items.forEach((item) => load(item.id));
  });

  onDestroy(() => {
    clearTimeout(timer);
    controller?.abort();
  });

  function search() {
    clearTimeout(timer);
    controller?.abort();
    const text = query.trim();
    searchError = "";
    if (text.length < 2) {
      results = [];
      searching = false;
      return;
    }
    searching = true;
    timer = setTimeout(async () => {
      controller = new AbortController();
      try {
        const response = await fetch(`${OPEN_VSX}/api/-/search?${new URLSearchParams({ query: text, size: "8" })}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        results = (data.extensions || []).filter((extension) => !extension.deprecated && ID_PATTERN.test(idOf(extension)));
        active = results.length ? 0 : -1;
      } catch (err) {
        if (err.name === "AbortError") return;
        results = [];
        searchError = "Couldn't reach Open VSX. Try again in a moment.";
      }
      searching = false;
    }, 250);
  }

  function add(extension) {
    const id = idOf(extension);
    if (added.has(key(id)) || full) return;
    items = [...items, { id, name: extension.displayName || extension.name, icon: extension.files?.icon || null }];
    commit();
    query = "";
    results = [];
    open = false;
    active = -1;
  }

  function remove(id) {
    items = items.filter((item) => key(item.id) !== key(id));
    commit();
  }

  function onKeydown(event) {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      open = true;
      active = (active + 1) % results.length;
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      active = (active - 1 + results.length) % results.length;
    } else if (event.key === "Enter" && open && results[active]) {
      event.preventDefault();
      add(results[active]);
    } else if (event.key === "Escape") {
      open = false;
    }
  }

  const downloads = (count) =>
    count >= 1e6 ? `${(count / 1e6).toFixed(1).replace(/\.0$/, "")}M` : count >= 1e3 ? `${Math.round(count / 1e3)}K` : String(count || 0);
</script>

<div class="picker">
  <div class="search">
    <input
      id="vscode-extensions"
      type="text"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      placeholder={full ? `You've added the maximum of ${max}` : "Search Open VSX, like “prettier” or “python”"}
      disabled={full}
      aria-expanded={open && results.length > 0}
      aria-controls={listId}
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      bind:value={query}
      on:input={() => { open = true; search(); }}
      on:focus={() => (open = true)}
      on:blur={() => (open = false)}
      on:keydown={onKeydown}
    />
    {#if open && query.trim().length >= 2}
      <ul class="results" id={listId} role="listbox">
        {#if searching && !results.length}
          <li class="note">Searching…</li>
        {:else if searchError}
          <li class="note">{searchError}</li>
        {:else if !results.length}
          <li class="note">No extensions match “{query.trim()}”.</li>
        {:else}
          {#each results as extension, index (idOf(extension))}
            {@const isAdded = added.has(key(idOf(extension)))}
            <li
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              aria-disabled={isAdded}
              class:active={index === active}
              class:added={isAdded}
              on:mousedown|preventDefault={() => add(extension)}
              on:mousemove={() => (active = index)}
            >
              {#if extension.files?.icon}
                <img src={extension.files.icon} alt="" loading="lazy" />
              {:else}
                <span class="icon-fallback" aria-hidden="true">{(extension.displayName || extension.name).slice(0, 1)}</span>
              {/if}
              <span class="result-text">
                <span class="result-name">{extension.displayName || extension.name}</span>
                <span class="result-meta">{idOf(extension)} · {downloads(extension.downloadCount)} installs</span>
                {#if extension.description}<span class="result-description">{extension.description}</span>{/if}
              </span>
              <span class="result-action">{isAdded ? "Added" : "Add"}</span>
            </li>
          {/each}
        {/if}
      </ul>
    {/if}
  </div>

  {#if items.length}
    <ul class="chips" aria-label="Extensions you've added">
      {#each items as item (key(item.id))}
        <li class="chip" class:missing={item.missing} title={item.missing ? "Not on Open VSX, so spaces can't install it" : item.id}>
          {#if item.icon}
            <img src={item.icon} alt="" loading="lazy" />
          {:else}
            <span class="icon-fallback" aria-hidden="true">{(item.name || item.id).slice(0, 1)}</span>
          {/if}
          <span class="chip-text">
            <span class="chip-name">{item.name || item.id}</span>
            <span class="chip-id">{item.missing ? "Not on Open VSX" : item.id}</span>
          </span>
          <button type="button" class="chip-remove" aria-label={`Remove ${item.name || item.id}`} on:click={() => remove(item.id)}>×</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">No extensions yet. Search above to add some.</p>
  {/if}
  <p class="count">{items.length} of {max}</p>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .search {
    position: relative;
  }

  .search input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    border: 1px solid var(--muted);
    border-radius: 4px;
    font-size: 14px;
    background: var(--ui-surface);
    color: var(--ui-text);
  }

  .search input:focus {
    outline: none;
    border-color: var(--blue);
  }

  .search input::placeholder {
    color: var(--muted);
  }

  .results {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 20;
    margin: 0;
    padding: 4px;
    list-style: none;
    max-height: 340px;
    overflow-y: auto;
    background: var(--ui-surface);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }

  .results li[role="option"] {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  .results li.active {
    background: var(--ui-hover);
  }

  .results li.added {
    cursor: default;
    opacity: 0.6;
  }

  .note {
    padding: 10px 8px;
    font-size: 13px;
    color: var(--ui-text-muted);
  }

  img,
  .icon-fallback {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    object-fit: contain;
  }

  .icon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: bold;
    text-transform: uppercase;
    color: var(--ui-text-muted);
    background: var(--ui-surface-alt);
  }

  .result-text,
  .chip-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .result-name,
  .chip-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--ui-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-meta,
  .chip-id {
    font-size: 12px;
    color: var(--ui-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-description {
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ui-text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .result-action {
    flex-shrink: 0;
    align-self: center;
    font-size: 12px;
    font-weight: 500;
    color: var(--ui-accent);
  }

  .results li.added .result-action {
    color: var(--ui-text-muted);
  }

  .chips {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 8px 6px 8px 10px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
  }

  .chip.missing {
    border-color: var(--ui-warning);
  }

  .chip.missing .chip-id {
    color: var(--ui-warning);
  }

  .chip-remove {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-muted);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .chip-remove:hover,
  .chip-remove:focus-visible {
    background: var(--ui-hover);
    color: var(--ui-text);
  }

  .empty,
  .count {
    margin: 0;
    font-size: 13px;
    color: var(--ui-text-muted);
  }

  .count {
    text-align: right;
  }
</style>
