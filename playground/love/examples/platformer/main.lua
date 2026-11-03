-- Platformer: keyboard input, tile collisions, coins, spikes and a goal.
-- Arrows / WASD to move, Up / W / Space to jump, R to restart.
local Player = require("player")

local TILE = 32
local MAP = {
  "                                                  ",
  "                                                  ",
  "                                                  ",
  "                                                  ",
  "                                                  ",
  "                                                  ",
  "                                     o o          ",
  "                     o o             ####         ",
  "                     ####                         ",
  "                                o o               ",
  "     o o        o o             ####              ",
  "     ####       ####                              ",
  "            ooo            o o             ##     ",
  "   P                                           G  ",
  "############   #####^^####    ####################",
  "############   ###########    ####################",
  "############^^^###########^^^^####################",
  "##################################################",
}

local player, solids, spikes, coins, goal
local spawnX, spawnY
local collected, deaths, timer, won
local font, bigFont
local camX = 0
local levelW, levelH

local function loadLevel()
  solids, spikes, coins = {}, {}, {}
  for row, line in ipairs(MAP) do
    for col = 1, #line do
      local c = line:sub(col, col)
      local x, y = (col - 1) * TILE, (row - 1) * TILE
      if c == "#" then
        solids[#solids + 1] = { x = x, y = y, w = TILE, h = TILE }
      elseif c == "^" then
        spikes[#spikes + 1] = { x = x + 4, y = y + TILE / 2, w = TILE - 8, h = TILE / 2 }
      elseif c == "o" then
        coins[#coins + 1] = { x = x + TILE / 2, y = y + TILE / 2, phase = love.math.random() * 6, taken = false }
      elseif c == "P" then
        spawnX, spawnY = x + 5, y + 2
      elseif c == "G" then
        goal = { x = x + 8, y = y - TILE, w = TILE - 8, h = TILE * 2 }
      end
    end
  end
  levelW, levelH = #MAP[1] * TILE, #MAP * TILE
end

local function restart()
  loadLevel()
  player = Player.new(spawnX, spawnY)
  collected, deaths, timer, won = 0, 0, 0, false
end

function love.load()
  love.graphics.setBackgroundColor(0.09, 0.09, 0.14)
  font = love.graphics.newFont(16)
  bigFont = love.graphics.newFont(42)
  restart()
end

function love.keypressed(key)
  if key == "up" or key == "w" or key == "space" then player:jump() end
  if key == "r" then restart() end
  if key == "escape" then love.event.quit() end
end

function love.update(dt)
  dt = math.min(dt, 1 / 30) -- avoid tunnelling after a hitch
  if won then return end
  timer = timer + dt
  player:update(dt, solids)

  for _, c in ipairs(coins) do
    if not c.taken and Player.overlaps(player, { x = c.x - 10, y = c.y - 10, w = 20, h = 20 }) then
      c.taken = true
      collected = collected + 1
    end
  end

  local dead = player.y > levelH
  for _, s in ipairs(spikes) do
    if Player.overlaps(player, s) then dead = true end
  end
  if dead then
    deaths = deaths + 1
    player = Player.new(spawnX, spawnY)
  end

  if Player.overlaps(player, goal) then won = true end

  -- Smooth camera that follows the player.
  local w = love.graphics.getWidth()
  local target = math.max(0, math.min(levelW - w, player.x - w / 2))
  camX = camX + (target - camX) * math.min(1, dt * 6)
end

local function drawBackground(w, h)
  -- Two layers of hills that scroll slower than the level (parallax).
  for layer = 1, 2 do
    local speed = layer * 0.25
    local base = h - 140 + layer * 40
    love.graphics.setColor(0.14 + layer * 0.04, 0.12 + layer * 0.03, 0.22 + layer * 0.04)
    local function height(x)
      local wx = x + camX * speed
      return base - math.sin(wx * 0.004 * layer) * 50 - math.sin(wx * 0.011) * 20
    end
    for x = 0, w, 16 do
      -- Each strip is a convex quad, so love.graphics.polygon can fill it directly.
      love.graphics.polygon("fill", x, height(x), x + 16, height(x + 16), x + 16, h, x, h)
    end
  end
end

function love.draw()
  local w, h = love.graphics.getDimensions()
  drawBackground(w, h)

  love.graphics.push()
  love.graphics.translate(-math.floor(camX), h - levelH)

  for _, s in ipairs(solids) do
    love.graphics.setColor(0.25, 0.22, 0.35)
    love.graphics.rectangle("fill", s.x, s.y, s.w, s.h)
    love.graphics.setColor(0.36, 0.32, 0.5)
    love.graphics.rectangle("fill", s.x, s.y, s.w, 4)
  end

  love.graphics.setColor(0.85, 0.85, 0.9)
  for _, s in ipairs(spikes) do
    for i = 0, 2 do
      local x = s.x + i * s.w / 3
      love.graphics.polygon("fill", x, s.y + s.h, x + s.w / 6, s.y, x + s.w / 3, s.y + s.h)
    end
  end

  local t = love.timer.getTime()
  for _, c in ipairs(coins) do
    if not c.taken then
      local sx = math.abs(math.sin(t * 3 + c.phase))
      love.graphics.setColor(1, 0.82, 0.25)
      love.graphics.ellipse("fill", c.x, c.y + math.sin(t * 4 + c.phase) * 2, 8 * sx + 1, 9)
    end
  end

  -- Goal flag.
  love.graphics.setColor(0.8, 0.8, 0.85)
  love.graphics.rectangle("fill", goal.x, goal.y, 4, goal.h)
  love.graphics.setColor(0.3, 0.9, 0.5)
  local wave = math.sin(t * 5) * 4
  love.graphics.polygon("fill", goal.x + 4, goal.y, goal.x + 30, goal.y + 10 + wave, goal.x + 4, goal.y + 20)

  player:draw()
  love.graphics.pop()

  love.graphics.setFont(font)
  love.graphics.setColor(1, 1, 1)
  love.graphics.print(("Coins: %d / %d    Deaths: %d    Time: %.1f"):format(collected, #coins, deaths, timer), 12, 10)
  love.graphics.setColor(1, 1, 1, 0.5)
  love.graphics.print("Arrows/WASD move, Space jumps, R restarts", 12, 30)

  if won then
    love.graphics.setColor(0, 0, 0, 0.6)
    love.graphics.rectangle("fill", 0, 0, w, h)
    love.graphics.setColor(1, 1, 1)
    love.graphics.setFont(bigFont)
    love.graphics.printf("You made it!", 0, h / 2 - 60, w, "center")
    love.graphics.setFont(font)
    love.graphics.printf(("%d of %d coins in %.1f seconds. Press R to play again."):format(collected, #coins, timer), 0, h / 2 + 4, w, "center")
  end
end
