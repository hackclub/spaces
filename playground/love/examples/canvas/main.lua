-- Canvas & blend modes: each tile renders the same overlapping circles into
-- its own canvas with a different blend mode. Below, a persistent canvas is
-- faded a little every frame to leave glowing trails. Hold the mouse to paint.
local modes = {
  { "alpha" }, { "add" }, { "subtract" }, { "replace" },
  { "multiply", "premultiplied" }, { "screen" }, { "lighten", "premultiplied" }, { "darken", "premultiplied" },
}
local tiles = {}
local TILE_W, TILE_H = 180, 120
local trails
local font
local t = 0
local paint = {}

function love.load()
  love.graphics.setBackgroundColor(0.07, 0.07, 0.1)
  font = love.graphics.newFont(13)
  for i = 1, #modes do tiles[i] = love.graphics.newCanvas(TILE_W, TILE_H) end
  trails = love.graphics.newCanvas(760, 250)
end

local function checkerboard(w, h)
  for y = 0, h, 20 do
    for x = 0, w, 20 do
      local c = ((x + y) / 20) % 2 == 0 and 0.35 or 0.55
      love.graphics.setColor(c, c, c)
      love.graphics.rectangle("fill", x, y, 20, 20)
    end
  end
  love.graphics.setColor(0.2, 0.5, 0.9)
  love.graphics.rectangle("fill", 0, h * 0.6, w, h * 0.4)
end

local function renderTile(canvas, mode, alphamode)
  love.graphics.setCanvas(canvas)
  love.graphics.clear(0, 0, 0, 1)
  love.graphics.setBlendMode("alpha")
  checkerboard(TILE_W, TILE_H)
  love.graphics.setBlendMode(mode, alphamode)
  local colors = { { 1, 0.2, 0.3, 0.85 }, { 0.2, 1, 0.4, 0.85 }, { 0.3, 0.4, 1, 0.85 } }
  for i, c in ipairs(colors) do
    local a = t + i * math.pi * 2 / 3
    -- Premultiplied modes expect the colour already multiplied by alpha.
    if alphamode == "premultiplied" then
      love.graphics.setColor(c[1] * c[4], c[2] * c[4], c[3] * c[4], c[4])
    else
      love.graphics.setColor(c)
    end
    love.graphics.circle("fill", TILE_W / 2 + math.cos(a) * 22, TILE_H / 2 + math.sin(a) * 22, 34)
  end
  love.graphics.setBlendMode("alpha")
  love.graphics.setCanvas()
end

function love.update(dt)
  t = t + dt
  if love.mouse.isDown(1) then
    local x, y = love.mouse.getPosition()
    paint[#paint + 1] = { x = x - 20, y = y - 330 }
  end
end

function love.draw()
  -- 1. The blend mode grid.
  for i, m in ipairs(modes) do
    renderTile(tiles[i], m[1], m[2])
    local col, row = (i - 1) % 4, math.floor((i - 1) / 4)
    local x, y = 20 + col * (TILE_W + 10), 20 + row * (TILE_H + 30)
    love.graphics.setColor(1, 1, 1)
    love.graphics.setBlendMode("alpha", "premultiplied")
    love.graphics.draw(tiles[i], x, y)
    love.graphics.setBlendMode("alpha")
    love.graphics.setFont(font)
    love.graphics.print(m[1], x, y + TILE_H + 4)
  end

  -- 2. Trails: fade what is already there, then draw new stuff on top.
  -- "subtract" takes a little off every pixel (colour and alpha), so old
  -- strokes fade out completely instead of leaving a grey ghost.
  love.graphics.setCanvas(trails)
  love.graphics.setBlendMode("subtract")
  love.graphics.setColor(1, 1, 1, 0.02)
  love.graphics.rectangle("fill", 0, 0, 760, 250)
  love.graphics.setBlendMode("add")
  for i = 1, 3 do
    local a = t * (1 + i * 0.3)
    local x = 380 + math.sin(a) * 300
    local y = 125 + math.sin(a * 1.7 + i) * 90
    love.graphics.setColor(i == 1 and 1 or 0.3, i == 2 and 1 or 0.3, i == 3 and 1 or 0.4, 0.9)
    love.graphics.circle("fill", x, y, 10)
  end
  love.graphics.setColor(0.91, 0.29, 0.6, 0.9)
  for _, p in ipairs(paint) do love.graphics.circle("fill", p.x, p.y, 8) end
  paint = {}
  love.graphics.setBlendMode("alpha")
  love.graphics.setCanvas()

  love.graphics.setColor(0.03, 0.03, 0.05)
  love.graphics.rectangle("fill", 20, 330, 760, 250)
  love.graphics.setColor(1, 1, 1)
  love.graphics.setBlendMode("alpha", "premultiplied")
  love.graphics.draw(trails, 20, 330)
  love.graphics.setBlendMode("alpha")
  love.graphics.setColor(1, 1, 1, 0.3)
  love.graphics.rectangle("line", 20, 330, 760, 250)
  love.graphics.setColor(1, 1, 1, 0.7)
  love.graphics.print("A canvas that is never cleared, only faded. Hold the left mouse button to paint.", 20, 312)
end

function love.keypressed(key)
  if key == "escape" then love.event.quit() end
end
