// Web compatibility checks: things a LÖVE game can do on desktop but not in
// the browser. The rules live in compat-rules.json, which package.py also uses.

let rulesPromise = null;

function loadRules() {
  rulesPromise ??= fetch(new URL('./compat-rules.json', import.meta.url))
    .then((r) => r.json())
    .then((j) => j.rules.map((r) => ({
      ...r,
      re: new RegExp(r.pattern, 'g'),
      unlessRe: r.unless ? new RegExp(r.unless) : null,
      unlessFileRe: r.unlessFile ? new RegExp(r.unlessFile) : null,
    })))
    .catch((e) => { rulesPromise = null; throw e; });
  return rulesPromise;
}

const blank = (s) => s.replace(/[^\n]/g, ' ');

/**
 * Lua text with comments blanked out (`source`), and with comments and string
 * contents blanked out (`code`). Newlines are kept so line numbers still match.
 */
export function stripLua(text) {
  const special = /--|["'[]/g;
  const longOpen = /\[(=*)\[/y;
  let source = '', code = '', i = 0;
  const longEnd = (level, from) => {
    const end = text.indexOf(`]${'='.repeat(level)}]`, from);
    return end < 0 ? text.length : end + level + 2;
  };
  while (i < text.length) {
    special.lastIndex = i;
    const m = special.exec(text);
    if (!m) break;
    source += text.slice(i, m.index);
    code += text.slice(i, m.index);
    let j;
    if (m[0] === '--') {
      longOpen.lastIndex = m.index + 2;
      const lm = longOpen.exec(text);
      if (lm) j = longEnd(lm[1].length, longOpen.lastIndex);
      else { j = text.indexOf('\n', m.index); if (j < 0) j = text.length; }
      const s = blank(text.slice(m.index, j));
      source += s;
      code += s;
    } else if (m[0] === '[') {
      longOpen.lastIndex = m.index;
      const lm = longOpen.exec(text);
      if (!lm) { source += '['; code += '['; i = m.index + 1; continue; }
      j = longEnd(lm[1].length, longOpen.lastIndex);
      source += text.slice(m.index, j);
      code += blank(text.slice(m.index, j));
    } else {  // quoted string
      j = m.index + 1;
      while (j < text.length && text[j] !== m[0] && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, text.length);
      source += text.slice(m.index, j);
      code += blank(text.slice(m.index, j));
    }
    i = j;
  }
  source += text.slice(i);
  code += text.slice(i);
  return { source, code };
}

function lineAt(text, index) {
  let line = 1;
  for (let k = text.indexOf('\n'); k >= 0 && k < index; k = text.indexOf('\n', k + 1)) line++;
  return line;
}

/**
 * Checks a project's Lua files. files: { path: string | Uint8Array }.
 * Returns [{ path, line, severity: 'error'|'warning'|'info', message }].
 */
export async function checkProject(files) {
  const rules = await loadRules();
  const decoder = new TextDecoder();
  const seen = new Set();
  const issues = [];
  for (const path of Object.keys(files).sort()) {
    if (!path.endsWith('.lua')) continue;
    const data = files[path];
    const stripped = stripLua(typeof data === 'string' ? data : decoder.decode(data));
    for (const rule of rules) {
      if (rule.once && seen.has(rule.id)) continue;
      if (rule.unlessFileRe?.test(stripped.code)) continue;
      const text = stripped[rule.scope] ?? stripped.code;
      for (const m of text.matchAll(rule.re)) {
        if (stripped.code[m.index] !== text[m.index]) continue;  // starts inside a string
        const start = text.lastIndexOf('\n', m.index) + 1;
        const end = text.indexOf('\n', m.index);
        if (rule.unlessRe?.test(stripped.source.slice(start, end < 0 ? undefined : end))) continue;
        issues.push({
          path,
          line: lineAt(text, m.index),
          severity: rule.severity,
          message: rule.message.replace('{1}', m[1] ?? ''),
        });
        seen.add(rule.id);
        if (rule.once) break;
      }
    }
  }
  return issues.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}
