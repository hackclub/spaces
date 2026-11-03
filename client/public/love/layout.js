// Resizable split panes. Sizes are CSS custom properties on #app and are
// remembered in localStorage.

const KEY = 'lws.layout';

const DEFAULTS = { sidebar: 240, right: 0.44, game: 0.6 };
const LIMITS = {
  sidebar: { min: 160, max: 480 },
  right: { min: 0.22, max: 0.7 }, // fraction of the workspace width
  game: { min: 0.15, max: 0.88 }, // fraction of the right pane height
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(sizes) {
  try { localStorage.setItem(KEY, JSON.stringify(sizes)); } catch { /* private mode */ }
}

const clamp = (v, { min, max }) => Math.max(min, Math.min(max, v));

export function initLayout(app, { onResize } = {}) {
  const sizes = load();
  const apply = () => {
    app.style.setProperty('--sidebar-w', `${clamp(sizes.sidebar, LIMITS.sidebar)}px`);
    app.style.setProperty('--right-w', `${clamp(sizes.right, LIMITS.right) * 100}%`);
    app.style.setProperty('--game-h', `${clamp(sizes.game, LIMITS.game) * 100}%`);
  };
  apply();

  const workspace = app.querySelector('#workspace');
  const rightPane = app.querySelector('#right-pane');

  for (const splitter of app.querySelectorAll('.splitter')) {
    const which = splitter.dataset.split;
    const update = (clientX, clientY) => {
      if (which === 'sidebar') {
        sizes.sidebar = clamp(clientX - workspace.getBoundingClientRect().left, LIMITS.sidebar);
      } else if (which === 'right') {
        const r = workspace.getBoundingClientRect();
        sizes.right = clamp((r.right - clientX) / r.width, LIMITS.right);
      } else if (which === 'game') {
        const r = rightPane.getBoundingClientRect();
        sizes.game = clamp((clientY - r.top) / r.height, LIMITS.game);
      }
      apply();
      onResize?.();
    };

    splitter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      app.classList.add('resizing', which === 'game' ? 'resizing-v' : 'resizing-h');
      const move = (ev) => update(ev.clientX, ev.clientY);
      const up = () => {
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', up);
        splitter.removeEventListener('pointercancel', up);
        app.classList.remove('resizing', 'resizing-v', 'resizing-h');
        save(sizes);
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
      splitter.addEventListener('pointercancel', up);
    });

    splitter.addEventListener('dblclick', () => {
      sizes[which] = DEFAULTS[which];
      apply();
      save(sizes);
      onResize?.();
    });

    // Keyboard resizing for accessibility.
    splitter.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 5 : 1;
      let delta = 0;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') delta = -step;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') delta = step;
      else return;
      e.preventDefault();
      if (which === 'sidebar') sizes.sidebar = clamp(sizes.sidebar + delta * 10, LIMITS.sidebar);
      else if (which === 'right') sizes.right = clamp(sizes.right - delta * 0.01, LIMITS.right);
      else sizes.game = clamp(sizes.game + delta * 0.01, LIMITS.game);
      apply();
      save(sizes);
      onResize?.();
    });
  }
}
