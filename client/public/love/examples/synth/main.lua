-- Synth: sounds generated sample by sample into SoundData, played with
-- love.audio. Press the keys A S D F G H J K (and W E T Y U for sharps).
-- 1-3 change the waveform. Click once first: browsers only allow audio
-- after you interact with the page.
local RATE = 44100
local keys = {
  { key = "a", note = 0 }, { key = "w", note = 1, sharp = true }, { key = "s", note = 2 },
  { key = "e", note = 3, sharp = true }, { key = "d", note = 4 }, { key = "f", note = 5 },
  { key = "t", note = 6, sharp = true }, { key = "g", note = 7 }, { key = "y", note = 8, sharp = true },
  { key = "h", note = 9 }, { key = "u", note = 10, sharp = true }, { key = "j", note = 11 },
  { key = "k", note = 12 },
}
local waves = {
  { name = "Sine", fn = function(p) return math.sin(p * 2 * math.pi) end },
  { name = "Square", fn = function(p) return p % 1 < 0.5 and 0.6 or -0.6 end },
  { name = "Saw", fn = function(p) return (p % 1) * 1.4 - 0.7 end },
}
local waveIndex = 1
local sounds = {}
local lit = {}
local scope = {}

local function makeNote(semitone, wave)
  local freq = 261.63 * 2 ^ (semitone / 12) -- middle C
  local length = 0.8
  local n = math.floor(RATE * length)
  local data = love.sound.newSoundData(n, RATE, 16, 1)
  for i = 0, n - 1 do
    local time = i / RATE
    local env = math.min(1, time / 0.01) * math.exp(-time * 4) -- quick attack, smooth decay
    data:setSample(i, wave(time * freq) * env * 0.5)
  end
  return data
end

local function build()
  for _, k in ipairs(keys) do
    local data = makeNote(k.note, waves[waveIndex].fn)
    k.data = data
    sounds[k.key] = love.audio.newSource(data)
  end
end

function love.load()
  love.graphics.setBackgroundColor(0.08, 0.07, 0.11)
  build()
end

local function play(k)
  local src = sounds[k.key]:clone()
  src:play()
  lit[k.key] = 1
  scope = {}
  for i = 0, 799 do scope[#scope + 1] = k.data:getSample(i * 4) end
end

function love.keypressed(key)
  local n = tonumber(key)
  if n and waves[n] then waveIndex = n; build() end
  for _, k in ipairs(keys) do
    if k.key == key then play(k) end
  end
  if key == "escape" then love.event.quit() end
end

function love.mousepressed(x, y)
  for _, k in ipairs(keys) do
    if k.rect and x >= k.rect[1] and x <= k.rect[1] + k.rect[3] and y >= k.rect[2] and y <= k.rect[2] + k.rect[4] then
      play(k)
    end
  end
end

function love.update(dt)
  for k, v in pairs(lit) do
    lit[k] = v - dt * 3
    if lit[k] <= 0 then lit[k] = nil end
  end
end

function love.draw()
  local w, h = love.graphics.getDimensions()
  -- Oscilloscope of the last note.
  love.graphics.setColor(0.91, 0.29, 0.6)
  love.graphics.setLineWidth(2)
  if #scope > 1 then
    local pts = {}
    for i, s in ipairs(scope) do
      pts[#pts + 1] = (i - 1) / (#scope - 1) * w
      pts[#pts + 1] = 150 - s * 200
    end
    love.graphics.line(pts)
  else
    love.graphics.line(0, 150, w, 150)
  end

  -- Keyboard: white keys first, black keys on top.
  local whiteW, x = 80, (w - 8 * 80) / 2
  local positions = {}
  for _, k in ipairs(keys) do
    if not k.sharp then
      k.rect = { x, 320, whiteW - 4, 220 }
      positions[k.note] = x
      x = x + whiteW
    end
  end
  for _, k in ipairs(keys) do
    if k.sharp then
      local px = positions[k.note - 1] + whiteW * 0.62
      k.rect = { px, 320, whiteW * 0.6, 130 }
    end
  end
  for pass = 1, 2 do
    for _, k in ipairs(keys) do
      if (pass == 1) == not k.sharp then
        local r = k.rect
        local glow = lit[k.key] or 0
        if k.sharp then
          love.graphics.setColor(0.15 + glow * 0.7, 0.14 + glow * 0.2, 0.2 + glow * 0.4)
        else
          love.graphics.setColor(0.95 - glow * 0.1, 0.94 - glow * 0.6, 0.97 - glow * 0.35)
        end
        love.graphics.rectangle("fill", r[1], r[2], r[3], r[4], 6)
        love.graphics.setColor(k.sharp and 1 or 0.3, k.sharp and 1 or 0.3, k.sharp and 1 or 0.35)
        love.graphics.printf(k.key:upper(), r[1], r[2] + r[4] - 24, r[3], "center")
      end
    end
  end

  love.graphics.setColor(1, 1, 1, 0.8)
  love.graphics.print(("Waveform: %s (1 Sine, 2 Square, 3 Saw)   Play with A-K and W E T Y U, or click the keys"):format(waves[waveIndex].name), 12, 10)
end
