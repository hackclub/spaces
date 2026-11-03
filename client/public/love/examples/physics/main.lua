-- Physics: a Box2D world with falling boxes and balls, a spinning paddle and
-- mouse dragging. Drag shapes with the left mouse button, right-click (or
-- press B / C) to drop new ones, Space for a shower, R to reset.
local world, ground, spinner
local objects = {}
local drag -- { joint = MouseJoint, object = ... }
local W, H

local palette = {
  { 0.91, 0.29, 0.6 }, { 0.36, 0.7, 1 }, { 1, 0.78, 0.3 }, { 0.45, 0.9, 0.6 }, { 0.7, 0.55, 1 },
}

local function addObject(kind, x, y)
  local body
  if kind == "ball" then
    body = love.physics.newCircleBody(world, "dynamic", x, y, love.math.random(12, 26))
  else
    local w, h = love.math.random(24, 60), love.math.random(24, 60)
    body = love.physics.newRectangleBody(world, "dynamic", x, y, w, h, love.math.random() * math.pi)
  end
  local shape = body:getShape()
  shape:setFriction(0.5)
  shape:setRestitution(kind == "ball" and 0.6 or 0.15)
  objects[#objects + 1] = { body = body, shape = shape, color = palette[love.math.random(#palette)] }
end

local function reset()
  if world then world:destroy() end
  objects, drag = {}, nil
  love.physics.setMeter(64)
  world = love.physics.newWorld(0, 9.81 * 64, true)

  -- Static level: floor, walls and two ramps, all shapes on one body.
  ground = love.physics.newBody(world, 0, 0, "static")
  love.physics.newEdgeShape(ground, 0, H - 10, W, H - 10)
  love.physics.newEdgeShape(ground, 0, -1000, 0, H)
  love.physics.newEdgeShape(ground, W, -1000, W, H)
  love.physics.newRectangleShape(ground, 190, 330, 300, 16, 0.35)
  love.physics.newRectangleShape(ground, 620, 420, 300, 16, -0.3)

  -- A kinematic body moves on its own and pushes dynamic bodies around.
  spinner = love.physics.newRectangleBody(world, "kinematic", W / 2, 180, 220, 14)
  spinner:setAngularVelocity(1.4)

  for i = 1, 25 do
    addObject(i % 3 == 0 and "ball" or "box", love.math.random(60, W - 60), love.math.random(-600, 0))
  end
end

function love.load()
  W, H = love.graphics.getDimensions()
  love.graphics.setBackgroundColor(0.08, 0.08, 0.11)
  reset()
end

function love.update(dt)
  if drag then drag.joint:setTarget(love.mouse.getPosition()) end
  world:update(dt)

  -- Remove anything that fell out of the world.
  for i = #objects, 1, -1 do
    local o = objects[i]
    if o.body:getY() > H + 200 then
      o.body:destroy()
      table.remove(objects, i)
    end
  end
end

function love.mousepressed(x, y, button)
  if button == 1 then
    for _, o in ipairs(objects) do
      if o.shape:testPoint(x, y) then
        drag = { joint = love.physics.newMouseJoint(o.body, x, y), object = o }
        drag.joint:setMaxForce(4000 * o.body:getMass())
        return
      end
    end
  elseif button == 2 then
    addObject(love.math.random() < 0.5 and "ball" or "box", x, y)
  end
end

function love.mousereleased(x, y, button)
  if button == 1 and drag then
    drag.joint:destroy()
    drag = nil
  end
end

function love.keypressed(key)
  local x = love.mouse.getX()
  if key == "b" then addObject("box", x, 40) end
  if key == "c" then addObject("ball", x, 40) end
  if key == "space" then
    for _ = 1, 15 do addObject(love.math.random() < 0.5 and "ball" or "box", love.math.random(60, W - 60), love.math.random(-300, 0)) end
  end
  if key == "r" then reset() end
  if key == "escape" then love.event.quit() end
end

local function drawShape(body, shape, mode)
  local t = shape:getType()
  if t == "circle" then
    local cx, cy = body:getWorldPoint(shape:getPoint())
    love.graphics.circle(mode, cx, cy, shape:getRadius())
    if mode == "fill" then
      -- A spoke so you can see the ball rotate.
      local a = body:getAngle()
      love.graphics.setColor(0, 0, 0, 0.35)
      love.graphics.line(cx, cy, cx + math.cos(a) * shape:getRadius(), cy + math.sin(a) * shape:getRadius())
    end
  elseif t == "polygon" then
    love.graphics.polygon(mode, body:getWorldPoints(shape:getPoints()))
  elseif t == "edge" then
    love.graphics.line(body:getWorldPoints(shape:getPoints()))
  end
end

function love.draw()
  love.graphics.setLineWidth(2)
  love.graphics.setColor(0.45, 0.45, 0.55)
  for _, s in ipairs(ground:getShapes()) do drawShape(ground, s, "fill") end

  love.graphics.setColor(0.91, 0.29, 0.6)
  drawShape(spinner, spinner:getShape(), "fill")

  for _, o in ipairs(objects) do
    local r, g, b = unpack(o.color)
    love.graphics.setColor(r, g, b, o.body:isAwake() and 1 or 0.6)
    drawShape(o.body, o.shape, "fill")
    love.graphics.setColor(1, 1, 1, 0.25)
    drawShape(o.body, o.shape, "line")
  end

  if drag then
    local ax, ay = drag.joint:getAnchors()
    local mx, my = love.mouse.getPosition()
    love.graphics.setColor(1, 1, 1, 0.6)
    love.graphics.line(ax, ay, mx, my)
    love.graphics.circle("fill", mx, my, 4)
  end

  love.graphics.setColor(1, 1, 1, 0.8)
  love.graphics.print(("Bodies: %d   Drag with the mouse, right-click/B/C to add, Space for a shower, R to reset"):format(#objects), 12, 10)
end
