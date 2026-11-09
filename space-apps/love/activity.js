const TIME_BETWEEN_HEARTBEATS_MS = 2 * 60 * 1000;
const DEBOUNCE_MS = 50;
let lastFile = null;
let lastHeartbeat = 0;
let debounceId = 0;

export function editorPosition() {
  const studio = window.studio;
  const editor = studio?.editor;
  const view = editor?.view;
  const project = studio?.state?.project?.id;
  if (!project || !editor?.current || !view) return null;
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return { project, path: editor.current, lineno: line.number, cursorpos: head - line.from + 1, lines: view.state.doc.lines };
}

export function markHeartbeat(position) {
  if (!position) return;
  lastFile = `${position.project}/${position.path}`;
  lastHeartbeat = Date.now();
}

function onEvent() {
  clearTimeout(debounceId);
  debounceId = setTimeout(() => {
    if (document.visibilityState !== 'visible') return;
    const position = editorPosition();
    if (!position) return;
    const file = `${position.project}/${position.path}`;
    if (file === lastFile && lastHeartbeat + TIME_BETWEEN_HEARTBEATS_MS >= Date.now()) return;
    markHeartbeat(position);
    fetch('api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(position),
      keepalive: true
    }).catch(() => {});
  }, DEBOUNCE_MS);
}

for (const type of ['keydown', 'pointerdown']) {
  window.addEventListener(type, onEvent, { capture: true, passive: true });
}
