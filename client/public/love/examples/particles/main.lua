-- Particles: a ParticleSystem whose texture is generated at runtime with
-- love.image.newImageData. Move the mouse, click for bursts, 1-3 for presets.
local glow, emitter, burst
local presetIndex = 1
local follow = { x = 400, y = 300 }

-- A soft round dot, drawn pixel by pixel.
local function makeGlowImage(size)
  local data = love.image.newImageData(size, size)
  local r = size / 2
  data:mapPixel(function(x, y)
    local dx, dy = (x + 0.5 - r) / r, (y + 0.5 - r) / r
    local a = math.max(0, 1 - math.sqrt(dx * dx + dy * dy))
    return 1, 1, 1, a * a
  end)
  return love.graphics.newImage(data)
end

local presets = {
  {
    name = "Fire",
    apply = function(ps)
      ps:setParticleLifetime(0.5, 1.4)
      ps:setEmissionRate(450)
      ps:setSizes(1.4, 0.9, 0.2)
      ps:setSizeVariation(0.6)
      ps:setSpeed(20, 90)
      ps:setDirection(-math.pi / 2)
      ps:setSpread(0.8)
      ps:setLinearAcceleration(-20, -260, 20, -420)
      ps:setEmissionArea("ellipse", 14, 6)
      ps:setColors(1, 0.95, 0.6, 1, 1, 0.55, 0.15, 0.9, 0.85, 0.15, 0.1, 0.5, 0.2, 0.05, 0.1, 0)
    end,
  },
  {
    name = "Magic",
    apply = function(ps)
      ps:setParticleLifetime(0.8, 2)
      ps:setEmissionRate(300)
      ps:setSizes(0.6, 0.3, 0.05)
      ps:setSizeVariation(1)
      ps:setSpeed(40, 160)
      ps:setDirection(0)
      ps:setSpread(math.pi * 2)
      ps:setLinearAcceleration(0, 0, 0, 0)
      ps:setTangentialAcceleration(80, 160)
      ps:setEmissionArea("none", 0, 0)
      ps:setColors(0.6, 0.8, 1, 1, 0.91, 0.29, 0.6, 0.8, 0.5, 0.2, 1, 0)
    end,
  },
  {
    name = "Snow",
    apply = function(ps)
      ps:setParticleLifetime(3, 5)
      ps:setEmissionRate(120)
      ps:setSizes(0.25, 0.35)
      ps:setSizeVariation(0.8)
      ps:setSpeed(20, 60)
      ps:setDirection(math.pi / 2)
      ps:setSpread(0.6)
      ps:setTangentialAcceleration(0, 0)
      ps:setLinearAcceleration(-15, 10, 15, 30)
      ps:setEmissionArea("uniform", 400, 4)
      ps:setColors(1, 1, 1, 0, 1, 1, 1, 0.9, 0.8, 0.9, 1, 0)
    end,
  },
}

local function usePreset(i)
  presetIndex = i
  emitter:reset()
  emitter:setTangentialAcceleration(0, 0)
  presets[i].apply(emitter)
end

function love.load()
  love.graphics.setBackgroundColor(0.05, 0.04, 0.08)
  glow = makeGlowImage(48)

  emitter = love.graphics.newParticleSystem(glow, 3000)
  usePreset(1)

  -- A second system for one-shot bursts: no continuous emission.
  burst = love.graphics.newParticleSystem(glow, 2000)
  burst:setParticleLifetime(0.4, 1.2)
  burst:setEmissionRate(0)
  burst:setSpeed(150, 450)
  burst:setSpread(math.pi * 2)
  burst:setLinearDamping(2, 4)
  burst:setLinearAcceleration(0, 200, 0, 300)
  burst:setSizes(0.5, 0.2)
  burst:setColors(1, 1, 1, 1, 1, 0.8, 0.3, 0.8, 1, 0.3, 0.6, 0)
end

function love.update(dt)
  local mx, my = love.mouse.getPosition()
  if not love.window.hasMouseFocus() then
    -- No mouse over the game: fly around on our own.
    local t, w, h = love.timer.getTime(), love.graphics.getDimensions()
    mx, my = w / 2 + math.cos(t * 1.3) * 200, h / 2 + math.sin(t * 2.1) * 120
  end
  if presets[presetIndex].name == "Snow" then
    mx, my = love.graphics.getWidth() / 2, -10
  end
  -- Ease the emitter towards the mouse so it leaves a trail.
  follow.x = follow.x + (mx - follow.x) * math.min(1, dt * 10)
  follow.y = follow.y + (my - follow.y) * math.min(1, dt * 10)
  emitter:moveTo(follow.x, follow.y)
  emitter:update(dt)
  burst:update(dt)
end

function love.mousepressed(x, y)
  burst:setPosition(x, y)
  burst:emit(250)
end

function love.keypressed(key)
  local n = tonumber(key)
  if n and presets[n] then usePreset(n) end
  if key == "escape" then love.event.quit() end
end

function love.draw()
  -- Additive blending makes overlapping particles glow.
  love.graphics.setBlendMode("add")
  love.graphics.setColor(1, 1, 1)
  love.graphics.draw(emitter)
  love.graphics.draw(burst)
  love.graphics.setBlendMode("alpha")

  love.graphics.setColor(1, 1, 1, 0.8)
  love.graphics.print(("Preset: %s   (1 Fire, 2 Magic, 3 Snow)   Click for a burst"):format(presets[presetIndex].name), 12, 10)
  love.graphics.print(("Particles: %d   FPS: %d"):format(emitter:getCount() + burst:getCount(), love.timer.getFPS()), 12, 30)
end
