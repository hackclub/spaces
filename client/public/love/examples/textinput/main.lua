-- Text input: love.textinput delivers UTF-8 text, and the utf8 library lets
-- us move the cursor and delete whole characters (not bytes).
local utf8 = require("utf8")

local text = ""
local cursor = 0          -- cursor position, in characters
local messages = {}
local font, bigFont
local blink = 0

local function len(s) return utf8.len(s) or #s end

-- Byte offset of the character at index i (0 = start of the string).
local function byteAt(s, i)
  return utf8.offset(s, i + 1) or (#s + 1)
end

local function insert(str)
  local b = byteAt(text, cursor)
  text = text:sub(1, b - 1) .. str .. text:sub(b)
  cursor = cursor + len(str)
  blink = 0
end

function love.load()
  love.keyboard.setKeyRepeat(true)
  love.keyboard.setTextInput(true)
  love.graphics.setBackgroundColor(0.1, 0.09, 0.13)
  font = love.graphics.newFont(20)
  bigFont = love.graphics.newFont(28)
  messages[1] = { text = "Type something and press Enter. Ünïcödé wörks: ÆØÅ, ñ, ß, € and ¿¡", system = true }
end

function love.textinput(t)
  insert(t)
end

function love.keypressed(key)
  local ctrl = love.keyboard.isDown("lctrl", "rctrl", "lgui", "rgui")
  if key == "backspace" and cursor > 0 then
    local a, b = byteAt(text, cursor - 1), byteAt(text, cursor)
    text = text:sub(1, a - 1) .. text:sub(b)
    cursor = cursor - 1
  elseif key == "delete" and cursor < len(text) then
    local a, b = byteAt(text, cursor), byteAt(text, cursor + 1)
    text = text:sub(1, a - 1) .. text:sub(b)
  elseif key == "left" then
    cursor = math.max(0, cursor - 1)
  elseif key == "right" then
    cursor = math.min(len(text), cursor + 1)
  elseif key == "home" then
    cursor = 0
  elseif key == "end" then
    cursor = len(text)
  elseif key == "v" and ctrl then
    insert(love.system.getClipboardText() or "")
  elseif key == "return" or key == "kpenter" then
    if #text > 0 then
      table.insert(messages, { text = text, time = os.date("%H:%M") })
      if #messages > 12 then table.remove(messages, 1) end
      text, cursor = "", 0
    end
  elseif key == "escape" then
    love.event.quit()
  end
  blink = 0
end

function love.update(dt)
  blink = blink + dt
end

function love.draw()
  local w, h = love.graphics.getDimensions()
  love.graphics.setFont(font)

  -- Message history.
  local y = 24
  for _, m in ipairs(messages) do
    if m.system then
      love.graphics.setColor(0.6, 0.58, 0.7)
      love.graphics.printf(m.text, 24, y, w - 48)
    else
      love.graphics.setColor(0.91, 0.29, 0.6)
      love.graphics.print(m.time, 24, y)
      love.graphics.setColor(1, 1, 1)
      love.graphics.printf(m.text, 90, y, w - 114)
    end
    local _, lines = font:getWrap(m.text, w - 114)
    y = y + #lines * font:getHeight() + 10
  end

  -- Input box.
  local boxY = h - 90
  love.graphics.setColor(0.16, 0.15, 0.21)
  love.graphics.rectangle("fill", 20, boxY, w - 40, 56, 10)
  love.graphics.setColor(0.91, 0.29, 0.6, 0.8)
  love.graphics.rectangle("line", 20, boxY, w - 40, 56, 10)

  love.graphics.setFont(bigFont)
  love.graphics.setColor(1, 1, 1)
  local x0 = 36
  love.graphics.print(text, x0, boxY + 10)
  if blink % 1 < 0.5 then
    local before = text:sub(1, byteAt(text, cursor) - 1)
    local cx = x0 + bigFont:getWidth(before)
    love.graphics.rectangle("fill", cx, boxY + 12, 2, bigFont:getHeight() - 4)
  end

  love.graphics.setFont(font)
  love.graphics.setColor(1, 1, 1, 0.5)
  love.graphics.print(("%d characters, %d bytes"):format(len(text), #text), 24, h - 30)
end
