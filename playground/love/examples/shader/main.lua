-- Shaders: a plasma background computed per pixel, and a ripple + pixelate
-- post-processing effect applied to a scene drawn into a canvas.
-- Move the mouse to push the ripple around. Space toggles the effect,
-- Up/Down change the pixel size.

local plasma = love.graphics.newShader([[
  uniform float time;
  uniform vec2 resolution;

  vec4 effect(vec4 color, Image tex, vec2 uv, vec2 screen) {
    vec2 p = (screen - 0.5 * resolution) / resolution.y * 6.0;
    float v = sin(p.x + time);
    v += sin((p.y + time) * 0.5);
    v += sin((p.x + p.y + time) * 0.5);
    vec2 c = p + vec2(sin(time / 3.0), cos(time / 2.0)) * 3.0;
    v += sin(sqrt(c.x * c.x + c.y * c.y + 1.0) + time);
    v *= 0.5;
    vec3 rgb = 0.5 + 0.5 * vec3(sin(v * 3.14159), sin(v * 3.14159 + 2.094), sin(v * 3.14159 + 4.188));
    return vec4(rgb * 0.55, 1.0) * color;
  }
]])

local ripple = love.graphics.newShader([[
  uniform float time;
  uniform vec2 mouse;
  uniform vec2 resolution;
  uniform float pixelSize;

  vec4 effect(vec4 color, Image tex, vec2 uv, vec2 screen) {
    vec2 d = screen - mouse;
    float dist = length(d);
    float wave = sin(dist * 0.06 - time * 6.0) * 8.0 * exp(-dist * 0.005);
    vec2 coord = uv + normalize(d + 0.0001) * wave / resolution;
    coord = (floor(coord * resolution / pixelSize) + 0.5) * pixelSize / resolution;
    vec4 c = Texel(tex, coord);
    c.rgb *= 0.88 + 0.12 * sin(screen.y * 2.0);  // scanlines
    return c * color;
  }
]])

local scene
local enabled = true
local pixelSize = 3
local time = 0
local font, small

function love.load()
  scene = love.graphics.newCanvas()
  font = love.graphics.newFont(64)
  small = love.graphics.newFont(14)
end

function love.keypressed(key)
  if key == "space" then enabled = not enabled end
  if key == "up" then pixelSize = math.min(16, pixelSize + 1) end
  if key == "down" then pixelSize = math.max(1, pixelSize - 1) end
  if key == "escape" then love.event.quit() end
end

function love.update(dt)
  time = time + dt
end

local function drawScene(w, h)
  love.graphics.clear(0, 0, 0, 0)
  love.graphics.setShader(plasma)
  plasma:send("time", time)
  plasma:send("resolution", { scene:getPixelDimensions() })
  love.graphics.rectangle("fill", 0, 0, w, h)
  love.graphics.setShader()

  -- Some spinning shapes on top.
  for i = 1, 8 do
    local a = time * 0.7 + i * math.pi / 4
    local x, y = w / 2 + math.cos(a) * 200, h / 2 + math.sin(a) * 140
    love.graphics.setColor(0.5 + 0.5 * math.sin(i), 0.5 + 0.5 * math.cos(i * 1.3), 1)
    love.graphics.push()
    love.graphics.translate(x, y)
    love.graphics.rotate(a * 2)
    love.graphics.rectangle("fill", -22, -22, 44, 44, 8)
    love.graphics.pop()
  end
  love.graphics.setColor(1, 1, 1)
  love.graphics.setFont(font)
  love.graphics.printf("SHADERS", 0, h / 2 - 40, w, "center")
end

function love.draw()
  local w, h = love.graphics.getDimensions()
  local dpi = love.graphics.getDPIScale()

  love.graphics.setCanvas(scene)
  drawScene(w, h)
  love.graphics.setCanvas()

  love.graphics.setColor(1, 1, 1)
  if enabled then
    local mx, my = love.mouse.getPosition()
    if not love.window.hasMouseFocus() then
      mx, my = w / 2 + math.cos(time * 0.8) * w * 0.3, h / 2 + math.sin(time * 1.1) * h * 0.25
    end
    love.graphics.setShader(ripple)
    ripple:send("time", time)
    ripple:send("mouse", { mx * dpi, my * dpi })
    ripple:send("resolution", { w * dpi, h * dpi })
    ripple:send("pixelSize", pixelSize * dpi)
  end
  love.graphics.setBlendMode("alpha", "premultiplied")
  love.graphics.draw(scene)
  love.graphics.setBlendMode("alpha")
  love.graphics.setShader()

  love.graphics.setFont(small)
  love.graphics.print(("Effect: %s (Space)   Pixel size: %d (Up/Down)"):format(enabled and "on" or "off", pixelSize), 12, 10)
end
