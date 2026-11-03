-- Walks the running LÖVE engine and prints a JSON description of its API.
-- Run it through the web player (see tools/README in the editor source, or
-- tools/introspect.html). Output lines are prefixed with "@@API " and must be
-- concatenated in order.

local function sortedKeys(t)
  local keys = {}
  for k in pairs(t) do if type(k) == "string" then keys[#keys + 1] = k end end
  table.sort(keys)
  return keys
end

local function esc(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' elseif c == '\\' then return '\\\\' end
    return string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function list(t)
  local out = {}
  for i, v in ipairs(t) do out[i] = esc(v) end
  return "[" .. table.concat(out, ",") .. "]"
end

local modules = {}
local loveFunctions = {}
for _, name in ipairs(sortedKeys(love)) do
  local v = love[name]
  if type(v) == "table" and name ~= "handlers" and name ~= "arg" then
    local fns = {}
    for _, fname in ipairs(sortedKeys(v)) do
      if type(v[fname]) == "function" then fns[#fns + 1] = fname end
    end
    if #fns > 0 then modules[#modules + 1] = esc(name) .. ":" .. list(fns) end
  elseif type(v) == "function" then
    loveFunctions[#loveFunctions + 1] = name
  end
end

-- Object types: LÖVE stores each type's metatable in the registry under the
-- type name, with __index pointing at itself and type/typeOf methods.
local types = {}
local reg = debug.getregistry()
local names = {}
for k, mt in pairs(reg) do
  if type(k) == "string" and type(mt) == "table" and rawget(mt, "__index") == mt
     and type(rawget(mt, "typeOf")) == "function" and type(rawget(mt, "type")) == "function" then
    names[#names + 1] = k
  end
end
table.sort(names)
for _, tname in ipairs(names) do
  local mt = reg[tname]
  local methods = {}
  for _, m in ipairs(sortedKeys(mt)) do
    if type(mt[m]) == "function" and not m:match("^__") then methods[#methods + 1] = m end
  end
  types[#types + 1] = esc(tname) .. ":" .. list(methods)
end

local json = '{"version":' .. esc(table.concat({ love.getVersion() }, ".", 1, 3))
  .. ',"love":' .. list(loveFunctions)
  .. ',"modules":{' .. table.concat(modules, ",") .. '}'
  .. ',"types":{' .. table.concat(types, ",") .. '}}'

for i = 1, #json, 800 do
  print("@@API " .. json:sub(i, i + 799))
end
print("@@END")
love.event.quit()
