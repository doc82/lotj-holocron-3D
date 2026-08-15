local source = debug.getinfo(1, "S").source
local path = (source:sub(1, 1) == "@" and source:sub(2) or source):gsub("\\", "/")
local root = path:match("^(.*)/tests/lua/run%.lua$") or "."
assert(_VERSION == "Lua 5.1", "Holocron3D Lua tests require Lua 5.1, got " .. tostring(_VERSION))
package.path = table.concat({
  root .. "/tests/lua/?.lua", root .. "/tests/lua/support/?.lua", root .. "/mudlet/?.lua",
  package.path,
}, ";")

local specs = {
  "parser_spec",
  "scraper_capture_spec",
  "scraper_polling_spec",
  "scraper_combat_spec",
  "scraper_commands_spec",
  "scraper_telemetry_spec",
  "scraper_fleet_spec",
}
local knownSpecs = {}
for _, name in ipairs(specs) do knownSpecs[name] = true end
local selected, filter
local index = 1
while index <= #arg do
  if arg[index] == "--file" then selected = arg[index + 1]; index = index + 2
  elseif arg[index] == "--filter" then filter = arg[index + 1]; index = index + 2
  else error("unknown Lua test option: " .. tostring(arg[index])) end
end
if selected then
  selected = selected:gsub("%.lua$", "")
  assert(knownSpecs[selected], "unknown Lua spec: " .. selected)
  require(selected)
else
  for _, name in ipairs(specs) do require(name) end
end
local harness = require("harness")
if not harness.run(filter) then os.exit(1) end
