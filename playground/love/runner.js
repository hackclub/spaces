// Runs games in the embedded player (player.html?embed=1).
//
// Every run gets a fresh iframe, i.e. a fresh engine instance. The browser
// caches love.wasm, so this is quick. Messages from stale iframes are ignored.

const PLAYER_URL = 'player.html?embed=1';

export class Runner {
  /**
   * host: element the iframe goes into.
   * handlers: {onState(state), onLog(level, text), onError(text), onTitle(title), onQuit(code), onShortcut(event)}
   */
  constructor(host, handlers) {
    this.host = host;
    this.handlers = handlers;
    this.frame = null;
    this.pending = null;
    this.state = 'idle'; // idle | loading | running | paused | stopped
    this.paused = false;
    this.stopTimer = 0;
    this.runId = 0;
    window.addEventListener('message', (e) => this.onMessage(e));
  }

  setState(state) {
    this.state = state;
    this.handlers.onState?.(state);
  }

  get active() {
    return this.state === 'loading' || this.state === 'running' || this.state === 'paused' || this.state === 'crashed';
  }

  /** game: {files: {path: string|Uint8Array}} or {love: Uint8Array} */
  /** query: extra player.html parameters, e.g. {scale: 'integer', jit: '0'} */
  run(game, { focus = true, query = {} } = {}) {
    this.destroy();
    this.focusOnStart = focus;
    this.runId++;
    const frame = document.createElement('iframe');
    frame.className = 'game-frame';
    frame.title = 'Game';
    frame.setAttribute('allow', 'autoplay; fullscreen; gamepad; clipboard-read; clipboard-write');
    const extra = new URLSearchParams(query).toString();
    frame.src = extra ? `${PLAYER_URL}&${extra}` : PLAYER_URL;
    frame.addEventListener('load', () => this.hookKeys(frame));
    this.frame = frame;
    this.pending = game;
    this.paused = false;
    this.host.append(frame);
    this.setState('loading');
  }

  post(msg) {
    this.frame?.contentWindow?.postMessage(msg, '*');
  }

  onMessage(e) {
    if (!this.frame || e.source !== this.frame.contentWindow) return;
    const msg = e.data;
    if (!msg || msg.source !== 'love-player') return;
    switch (msg.type) {
      case 'ready':
        if (this.pending) {
          const game = this.pending;
          this.pending = null;
          this.post({ type: 'run', ...game });
        }
        break;
      case 'started':
        this.setState('running');
        if (this.focusOnStart) this.focus();
        break;
      case 'log':
        this.handlers.onLog?.(msg.level, msg.text);
        break;
      case 'error':
        // An error before 'started' means the engine itself failed to load.
        if (this.state === 'loading') {
          this.pending = null;
          this.setState('crashed');
        }
        this.handlers.onError?.(msg.text);
        break;
      case 'title':
        this.handlers.onTitle?.(msg.title);
        break;
      case 'quit':
        clearTimeout(this.stopTimer);
        this.handlers.onQuit?.(msg.code);
        this.destroy();
        this.setState('stopped');
        break;
      default:
        break;
    }
  }

  /** Ask the game to quit; force it after a moment if it doesn't. */
  stop() {
    if (!this.frame) return;
    if (this.state === 'loading' || this.state === 'crashed') {
      this.destroy();
      this.setState('stopped');
      return;
    }
    if (this.paused) this.post({ type: 'pause', paused: false });
    this.post({ type: 'stop' });
    clearTimeout(this.stopTimer);
    const id = this.runId;
    this.stopTimer = setTimeout(() => {
      if (id !== this.runId || !this.frame) return;
      this.destroy();
      this.setState('stopped');
    }, 1500);
  }

  setPaused(paused) {
    if (!this.frame || (this.state !== 'running' && this.state !== 'paused')) return;
    this.paused = paused;
    this.post({ type: 'pause', paused });
    this.setState(paused ? 'paused' : 'running');
    if (!paused) this.focus();
  }

  focus() {
    if (!this.frame) return;
    this.frame.focus();
    this.post({ type: 'focus' });
  }

  destroy() {
    clearTimeout(this.stopTimer);
    if (this.frame) {
      this.frame.remove();
      this.frame = null;
    }
    this.pending = null;
  }

  /**
   * The player is same-origin, so we can listen for the editor's shortcuts
   * inside it. Without this, F5 in the game would reload the whole editor.
   */
  hookKeys(frame) {
    try {
      const win = frame.contentWindow;
      win.addEventListener('keydown', (e) => {
        if (this.handlers.onShortcut?.(e)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }, true);
    } catch {
      /* cross-origin: nothing to do */
    }
  }
}

/**
 * Open an empty window synchronously (inside the click handler, so popup
 * blockers allow it); fill it later with showInPopup().
 */
export function openPopup() {
  const win = window.open('', '_blank', 'popup,width=840,height=660');
  if (win) {
    try {
      win.document.title = 'LÖVE';
      win.document.body.style.cssText = 'margin:0;background:#0d0d10;color:#8b8899;font:14px system-ui;display:grid;place-items:center;height:100vh';
      win.document.body.textContent = 'Packing game…';
    } catch { /* ignore */ }
  }
  return win;
}

/**
 * Load the game in a window from openPopup(). The player fetches it from a
 * blob: URL (player.html?game=blob:...), which works because blob URLs are
 * same-origin.
 */
export function showInPopup(win, loveBytes, title) {
  const url = URL.createObjectURL(new Blob([loveBytes], { type: 'application/zip' }));
  win.location.href = `player.html?game=${encodeURIComponent(url)}`;

  // Show the project name instead of the blob id on the player's start screen.
  let tries = 0;
  const rename = setInterval(() => {
    tries++;
    try {
      const el = win.document.getElementById('overlay-title');
      if (el && win.location.pathname.endsWith('player.html')) {
        clearInterval(rename);
        win.document.title = title;
        const fix = () => { if (el.textContent !== title) el.textContent = title; };
        fix();
        new win.MutationObserver(fix).observe(el, { childList: true, characterData: true, subtree: true });
      }
    } catch { /* not loaded yet */ }
    if (tries > 100 || win.closed) clearInterval(rename);
  }, 50);

  // The blob must stay alive while the window downloads it.
  const check = setInterval(() => {
    if (win.closed) {
      clearInterval(check);
      URL.revokeObjectURL(url);
    }
  }, 2000);
}
