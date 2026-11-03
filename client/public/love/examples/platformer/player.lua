-- The player: a rectangle with velocity, gravity and tile collisions.
local Player = {}
Player.__index = Player

local GRAVITY = 1900
local MAX_FALL = 1100
local MOVE_SPEED = 270
local ACCEL = 2600
local FRICTION = 2200
local JUMP_SPEED = 680
local COYOTE_TIME = 0.1   -- you can still jump just after walking off a ledge
local JUMP_BUFFER = 0.12  -- a jump pressed just before landing still counts

function Player.new(x, y)
  return setmetatable({
    x = x, y = y, w = 22, h = 30,
    vx = 0, vy = 0,
    onGround = false,
    coyote = 0, buffer = 0,
    facing = 1, squash = 0,
  }, Player)
end

function Player:jump()
  self.buffer = JUMP_BUFFER
end

local function overlaps(a, b)
  return a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h
end
Player.overlaps = overlaps

function Player:update(dt, solids)
  -- Horizontal input with acceleration and friction.
  local dir = 0
  if love.keyboard.isDown("left", "a") then dir = dir - 1 end
  if love.keyboard.isDown("right", "d") then dir = dir + 1 end
  if dir ~= 0 then
    self.vx = math.max(-MOVE_SPEED, math.min(MOVE_SPEED, self.vx + dir * ACCEL * dt))
    self.facing = dir
  else
    local f = FRICTION * dt
    if math.abs(self.vx) <= f then self.vx = 0 else self.vx = self.vx - f * (self.vx > 0 and 1 or -1) end
  end

  -- Jumping with coyote time and input buffering.
  self.coyote = self.onGround and COYOTE_TIME or math.max(0, self.coyote - dt)
  self.buffer = math.max(0, self.buffer - dt)
  if self.buffer > 0 and self.coyote > 0 then
    self.vy = -JUMP_SPEED
    self.buffer, self.coyote = 0, 0
    self.onGround = false
    self.squash = -0.3
  end

  -- Releasing the jump key early makes a shorter jump.
  local gravity = GRAVITY
  if self.vy < 0 and not love.keyboard.isDown("up", "w", "space") then gravity = gravity * 2.2 end
  self.vy = math.min(self.vy + gravity * dt, MAX_FALL)

  -- Move one axis at a time and push out of any solid we hit.
  self.x = self.x + self.vx * dt
  for _, s in ipairs(solids) do
    if overlaps(self, s) then
      if self.vx > 0 then self.x = s.x - self.w elseif self.vx < 0 then self.x = s.x + s.w end
      self.vx = 0
    end
  end

  local wasOnGround = self.onGround
  self.onGround = false
  self.y = self.y + self.vy * dt
  for _, s in ipairs(solids) do
    if overlaps(self, s) then
      if self.vy > 0 then
        self.y = s.y - self.h
        self.onGround = true
      elseif self.vy < 0 then
        self.y = s.y + s.h
      end
      self.vy = 0
    end
  end
  if self.onGround and not wasOnGround then self.squash = 0.35 end
  self.squash = self.squash * math.max(0, 1 - dt * 12)
end

function Player:draw()
  local sx, sy = 1 + self.squash, 1 - self.squash
  local cx, by = self.x + self.w / 2, self.y + self.h
  love.graphics.push()
  love.graphics.translate(cx, by)
  love.graphics.scale(sx, sy)
  love.graphics.setColor(0.91, 0.29, 0.6)
  love.graphics.rectangle("fill", -self.w / 2, -self.h, self.w, self.h, 6, 6)
  -- Eyes look where we are going.
  love.graphics.setColor(1, 1, 1)
  local ex = self.facing * 4
  love.graphics.circle("fill", ex - 4, -self.h + 10, 4)
  love.graphics.circle("fill", ex + 5, -self.h + 10, 4)
  love.graphics.setColor(0.1, 0.1, 0.15)
  love.graphics.circle("fill", ex - 4 + self.facing * 1.5, -self.h + 10, 2)
  love.graphics.circle("fill", ex + 5 + self.facing * 1.5, -self.h + 10, 2)
  love.graphics.pop()
end

return Player
