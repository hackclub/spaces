// Project templates: the built-in blank project plus the examples listed in
// examples/index.json (plain folders of files next to the editor).

import { classifyBytes } from './file-types.js';

export const BLANK = {
  id: 'blank',
  name: 'Blank',
  description: 'An empty game with love.load, love.update and love.draw.',
  files: {
    'main.lua': `function love.load()
  -- Runs once when the game starts.
  x, y = 400, 300
end

function love.update(dt)
  -- Runs every frame. dt is the time since the last frame, in seconds.
  local speed = 200
  if love.keyboard.isDown("left") then x = x - speed * dt end
  if love.keyboard.isDown("right") then x = x + speed * dt end
  if love.keyboard.isDown("up") then y = y - speed * dt end
  if love.keyboard.isDown("down") then y = y + speed * dt end
end

function love.draw()
  -- Runs every frame after update. Draw everything here.
  love.graphics.setColor(0.91, 0.29, 0.6)
  love.graphics.circle("fill", x, y, 24)
  love.graphics.setColor(1, 1, 1)
  love.graphics.print("Use the arrow keys to move", 10, 10)
end

function love.keypressed(key)
  if key == "escape" then
    love.event.quit()
  end
end
`,
    'conf.lua': `function love.conf(t)
  t.identity = "my-game"       -- save folder name
  t.window.title = "My Game"
  t.window.width = 800
  t.window.height = 600
end
`,
  },
};

let examplesPromise = null;

export function loadExampleIndex() {
  if (!examplesPromise) {
    examplesPromise = fetch('examples/index.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return examplesPromise;
}

/** Fetch an example's files: {path: string | Uint8Array}. */
export async function loadTemplateFiles(template) {
  if (template.id === 'blank') return { ...BLANK.files };
  const files = {};
  await Promise.all(template.files.map(async (path) => {
    const url = `examples/${encodeURIComponent(template.id)}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
    files[path] = classifyBytes(path, new Uint8Array(await res.arrayBuffer()));
  }));
  return files;
}
