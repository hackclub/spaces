local t = 0
local hearts = {}

function love.load()
  love.graphics.setBackgroundColor(0.11, 0.1, 0.14)
  font = love.graphics.newFont(28)
  small = love.graphics.newFont(14)
end

function love.update(dt)
  t = t + dt
  for i = #hearts, 1, -1 do
    local h = hearts[i]
    h.y = h.y - h.speed * dt
    h.life = h.life - dt
    if h.life <= 0 then table.remove(hearts, i) end
  end
end

function love.mousepressed(x, y)
  for _ = 1, 12 do
    hearts[#hearts + 1] = { x = x + love.math.random(-30, 30), y = y, speed = love.math.random(40, 120), life = 2 }
  end
end

function love.keypressed(key)
  if key == "escape" then love.event.quit() end
end

function love.draw()
  local w, h = love.graphics.getDimensions()
  love.graphics.setColor(0.91, 0.29, 0.6)
  love.graphics.circle("fill", w / 2 + math.cos(t) * 150, h / 2 + math.sin(t * 1.3) * 100, 40)
  for _, p in ipairs(hearts) do
    love.graphics.setColor(1, 0.4, 0.7, p.life / 2)
    love.graphics.circle("fill", p.x, p.y, 6)
  end
  love.graphics.setColor(1, 1, 1)
  love.graphics.setFont(font)
  love.graphics.printf("Hello, LÖVE " .. table.concat({ love.getVersion() }, ".", 1, 3), 0, 40, w, "center")
  love.graphics.setFont(small)
  love.graphics.print(("FPS: %d   Click to make hearts"):format(love.timer.getFPS()), 10, h - 24)
end
