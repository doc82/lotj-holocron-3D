-- LotJ Holocron 3D - parsers for space command output
-- Pure Lua 5.1: this module has no Mudlet dependencies and is safe to test alone.

local Parsers = {}

local function trim(value)
  return (value:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function cleanLine(value)
  value = tostring(value or "")
  -- Mudlet normally supplies plain text, but accepting copied terminal output is
  -- useful for fixtures and diagnostics. This removes common ANSI CSI escapes.
  value = value:gsub("\27%[[%d;?]*[A-Za-z]", "")
  value = value:gsub("\r", "")
  return trim(value)
end

local function linesFrom(input)
  if type(input) == "string" then
    local lines = {}
    input = input:gsub("\r\n", "\n"):gsub("\r", "\n")
    if input:sub(-1) ~= "\n" then
      input = input .. "\n"
    end
    for line in input:gmatch("(.-)\n") do
      table.insert(lines, cleanLine(line))
    end
    return lines
  end

  if type(input) == "table" then
    local lines = {}
    for _, line in ipairs(input) do
      table.insert(lines, cleanLine(line))
    end
    return lines
  end

  return nil, "output must be a string or an array of lines"
end

local function number(value)
  if type(value) ~= "string" and type(value) ~= "number" then
    return nil
  end
  return tonumber((tostring(value):gsub(",", "")))
end

local function vector(value)
  local x, y, z = value:match("^%s*([+-]?[%d,]+%.?%d*)[%s,]+([+-]?[%d,]+%.?%d*)[%s,]+([+-]?[%d,]+%.?%d*)%s*$")
  if not x then
    return nil
  end
  return {x = number(x), y = number(y), z = number(z)}
end

local function amount(value)
  local current, maximum = value:match("([+-]?[%d,]+)%s*/%s*([+-]?[%d,]+)")
  if current then
    return {current = number(current), maximum = number(maximum)}
  end

  local single = value:match("([+-]?[%d,]+)")
  if single then
    return {current = number(single)}
  end
  return nil
end

local function slug(value)
  local result = value:lower():gsub("[^%w]+", "-"):gsub("^-", ""):gsub("-$", "")
  if result == "" then
    return "unknown"
  end
  return result
end

local function classify(name, class)
  local value = ((class or "") .. " " .. (name or "")):lower()
  if value:find("planet", 1, true) then return "planet" end
  if value:find("moon", 1, true) then return "moon" end
  if value:find("asteroid", 1, true) then return "asteroid" end
  if value:find("missile", 1, true) or value:find("torpedo", 1, true)
      or value:find("rocket", 1, true) or value:find("bomb", 1, true) then
    return "projectile"
  end
  -- In current radar output, a quoted display name is preceded by its ship
  -- class. Do not mistake "Star Destroyer" for a stellar object.
  if class and class ~= "" then return "ship" end
  if value == "star" or value == "sun" or value:match("%sstar$")
      or value:match("%ssun$") then return "star" end
  return "ship"
end

local function parseDisplayName(raw)
  raw = trim(raw:gsub("%s+%[[^%]]+%]%s*$", ""))
  -- Proximity output labels its value column at the end of the contact name.
  raw = trim(raw:gsub("%s+[Pp][Rr][Oo][Xx]%s*$", ""))
  raw = trim(raw:gsub("%s+[Vv][Ee][Ll][Oo][Cc][Ii][Tt][Yy]%s*$", ""))
  local class, quoted = raw:match("^(.-)%s+'(.-)'%s*$")
  if quoted then
    return quoted, trim(class)
  end
  return raw, nil
end

local function addUniqueIds(items)
  local seen = {}
  for _, item in ipairs(items) do
    local base = slug(item.name)
    seen[base] = (seen[base] or 0) + 1
    item.id = seen[base] == 1 and base or (base .. "-" .. seen[base])
  end
end

local function isDecoration(line)
  return line == "" or line:match("^[%s%-%+=_|:]+$") ~= nil
end

local function resultOrError(result, recognized, command)
  if recognized == 0 then
    return nil, "no " .. command .. " data was recognized"
  end
  result.recognizedLines = recognized
  return result
end

function Parsers.parseRadar(input)
  local lines, err = linesFrom(input)
  if not lines then return nil, err end

  local result = {source = "radar", entities = {}}
  local recognized = 0
  local sawEntity = false

  for _, line in ipairs(lines) do
    local label, x, y, z = line:match("^(.-)%s+([+-]?[%d,]+%.?%d*)%s+([+-]?[%d,]+%.?%d*)%s+([+-]?[%d,]+%.?%d*)%s*$")
    if label then
      label = trim(label)
      local position = {x = number(x), y = number(y), z = number(z)}
      if label:lower():match("^your%s+coordinates%s*:") then
        result.observer = position
      else
        local name, class = parseDisplayName(label)
        local kind = classify(name, class)
        -- Current LotJ radar output gives ships as Class 'Name', while
        -- unquoted rows are celestial contacts (for example Dromund Kaas).
        -- Radar alone cannot reliably distinguish a planet from a star.
        if not class and kind == "ship" then kind = "celestial" end
        table.insert(result.entities, {
          name = name,
          class = class,
          kind = kind,
          x = position.x,
          y = position.y,
          z = position.z,
        })
        sawEntity = true
      end
      recognized = recognized + 1
    elseif not sawEntity and not result.system and not isDecoration(line)
        and not line:lower():find("coordinate", 1, true)
        and not line:lower():match("^radar") then
      result.system = line:gsub("^Starsystem:%s*", "")
    end
  end

  addUniqueIds(result.entities)
  return resultOrError(result, recognized, "radar")
end

local function parseProximity(input, velocityMode)
  local lines, err = linesFrom(input)
  if not lines then return nil, err end

  local source = velocityMode and "prox_velocity" or "prox"
  local result = {source = source, entities = {}}
  local recognized = 0

  for _, line in ipairs(lines) do
    local lower = line:lower()
    local coordinateText = line:match("^[Yy]our%s+[Cc]oordinates%s*:%s*(.+)$")
    local observer = coordinateText and vector(coordinateText) or nil
    if observer then
      result.observer = observer
      recognized = recognized + 1
    elseif not isDecoration(line) and line:sub(1, 1) ~= "{"
        and line:sub(1, 1) ~= "[" and not lower:match("^proximity")
        and not lower:match("^object%s+") and not lower:match("^name%s+") then
      local label, value = line:match("^(.-)%s*[:|]%s*([+-]?[%d,]+%.?%d*)%s*(.-)%s*$")
      if not label then
        label, value = line:match("^(.-)%s%s+([+-]?[%d,]+%.?%d*)%s*(.-)%s*$")
      end
      if not label then
        label, value = line:match("^(.-)%s+([+-]?[%d,]+%.?%d*)%s+units?%s*$")
      end

      if label and value then
        local name, class = parseDisplayName(label)
        local entity = {name = name, class = class, kind = classify(name, class)}
        if velocityMode then
          entity.speed = number(value)
        else
          entity.distance = number(value)
        end
        table.insert(result.entities, entity)
        recognized = recognized + 1
      else
        local name, distance = line:match("^(.-)%s+is%s+now%s+([%d,]+%.?%d*)%s+units?%s+away%.?$")
        if name and not velocityMode then
          table.insert(result.entities, {
            name = trim(name),
            kind = classify(name),
            distance = number(distance),
          })
          recognized = recognized + 1
        end
      end
    end
  end

  addUniqueIds(result.entities)
  return resultOrError(result, recognized, source)
end

function Parsers.parseProx(input)
  return parseProximity(input, false)
end

function Parsers.parseProxVelocity(input)
  return parseProximity(input, true)
end

local STATUS_KEYS = {
  ["current coordinates"] = "coordinates",
  ["coordinates"] = "coordinates",
  ["current heading"] = "heading",
  ["heading"] = "heading",
  ["current speed"] = "speed",
  ["speed"] = "speed",
  ["hull"] = "hull",
  ["shields"] = "shields",
  ["energy"] = "energy",
  ["energy(fuel)"] = "energy",
  ["fuel"] = "energy",
  ["ship condition"] = "condition",
  ["laser condition"] = "laserCondition",
  ["current target"] = "target",
  ["missiles"] = "missiles",
  ["torpedos"] = "torpedoes",
  ["torpedoes"] = "torpedoes",
  ["rockets"] = "rockets",
  ["primary target"] = "target",
  ["autopilot status"] = "autopilotStatus",
  ["ion condition"] = "ionCondition",
  ["launcher condition"] = "launcherCondition",
  ["escape pods"] = "escapePods",
}

local function assignStatus(result, rawKey, rawValue)
  local key = trim(rawKey):lower()
  local field = STATUS_KEYS[key]
  if not field then
    local turret = key:match("^turret%s+(.+)$")
    if turret then
      result.turrets = result.turrets or {}
      table.insert(result.turrets, {name = "Turret " .. turret, condition = trim(rawValue)})
      return true
    end
    return false
  end

  local value = trim(rawValue)
  if field == "coordinates" or field == "heading" then
    local parsed = vector(value)
    if not parsed then return false end
    result[field] = parsed
  elseif field == "speed" or field == "hull" or field == "shields"
      or field == "energy" or field == "missiles" or field == "torpedoes"
      or field == "rockets" or field == "escapePods" then
    local parsed = amount(value)
    if not parsed then return false end
    result[field] = parsed
  else
    result[field] = value
  end
  return true
end

function Parsers.parseStatus(input)
  local lines, err = linesFrom(input)
  if not lines then return nil, err end

  local result = {source = "status"}
  local recognized = 0

  for _, line in ipairs(lines) do
    if not isDecoration(line) then
      local requiredSensors = line:match("[Nn]eed%s+(%d+)%s+sensors%s+to%s+scan%s+for%s+lifeforms")
      local detectedLifeforms = line:match("[Ll]ifeforms%s+detected:%s*(.+)$")
      if requiredSensors then
        result.lifeformScan = {available = false, requiredSensors = number(requiredSensors)}
        recognized = recognized + 1
      elseif detectedLifeforms then
        result.lifeformScan = {available = true, value = trim(detectedLifeforms)}
        recognized = recognized + 1
      end
      local foundPair = false
      -- Status often prints two or more key/value pairs on one line. A new key
      -- begins after two spaces; values themselves may contain single spaces.
      local padded = line .. "  "
      local cursor = 1
      while cursor <= #line do
        local keyStart, colon, key = padded:find("%s*([^:]+):", cursor)
        if not colon then break end
        local nextStart = padded:find("%s%s+[^:]+:", colon + 1)
        local valueEnd = nextStart and (nextStart - 1) or #line
        local value = trim(padded:sub(colon + 1, valueEnd))
        if assignStatus(result, key, value) then
          recognized = recognized + 1
          foundPair = true
        end
        if not nextStart then break end
        cursor = nextStart
      end

      if not foundPair and not result.name then
        local name = line:match("^(.-):$")
        if name and not STATUS_KEYS[name:lower()] then
          name = trim(name):gsub("^[Rr]eadout%s+for%s+", "")
          result.name, result.class = parseDisplayName(name)
          result.kind = "ship"
          result.id = slug(result.name)
          recognized = recognized + 1
        end
      end
    end
  end

  return resultOrError(result, recognized, "status")
end

function Parsers.parseInfo(input)
  local lines, err = linesFrom(input)
  if not lines then return nil, err end

  -- Ship info also contains private access codes. Deliberately allow-list only
  -- public identity, size class, sensors, speed, and non-sensitive weapon counts.
  local result = {source = "info"}
  local recognized = 0
  local weaponPatterns = {
    autoblasters = "[Aa]utoblasters:%s*([%d,]+)",
    laserCannons = "[Ll]aser%s+[Cc]annons:%s*([%d,]+)",
    turbolasers = "[Tt]urbolasers:%s*([%d,]+)",
    ionCannons = "[Ii]on%s+[Cc]annons:%s*([%d,]+)",
    maximumMissiles = "[Mm]aximum%s+[Mm]issiles:%s*([%d,]+)",
    maximumTorpedoes = "[Mm]aximum%s+[Tt]orpedoes:%s*([%d,]+)",
    maximumRockets = "[Mm]aximum%s+[Rr]ockets:%s*([%d,]+)",
    maximumPulses = "[Mm]aximum%s+[Pp]ulses:%s*([%d,]+)",
    missileTubes = "[Mm]issile%s+[Tt]ubes:%s*([%d,]+)",
  }
  local weapons = {}
  local weaponFieldCount = 0
  for _, line in ipairs(lines) do
    local category, description = line:match("^%[Class:%s*([^%]]+)%]%s*:%s*(.+)$")
    if category and description then
      result.shipCategory = trim(category)
      result.name, result.class = parseDisplayName(description)
      recognized = recognized + 1
    end
    local sensorArray = line:match("[Ss]ensor%s+[Aa]rray:%s*([%d,]+)")
    if sensorArray then
      result.sensorArray = math.max(0, number(sensorArray) or 0)
      result.radarRange = 500 + (result.sensorArray * 10)
      recognized = recognized + 1
    end
    local maximumSpeed = line:match("[Mm]aximum%s+[Ss]peed:%s*([%d,]+)")
    if maximumSpeed then
      result.maximumSpeed = math.max(0, number(maximumSpeed) or 0)
      recognized = recognized + 1
    end
    for field, pattern in pairs(weaponPatterns) do
      local value = line:match(pattern)
      if value then
        if weapons[field] == nil then weaponFieldCount = weaponFieldCount + 1 end
        weapons[field] = math.max(0, number(value) or 0)
        recognized = recognized + 1
      end
    end
  end

  if next(weapons) then
    result.weapons = weapons
    if weaponFieldCount == 9 then
      local launchersArmed = weapons.missileTubes > 0
        and (weapons.maximumMissiles > 0 or weapons.maximumTorpedoes > 0
          or weapons.maximumRockets > 0 or weapons.maximumPulses > 0)
      result.hasWeapons = weapons.autoblasters > 0 or weapons.laserCannons > 0
        or weapons.turbolasers > 0 or weapons.ionCannons > 0 or launchersArmed
    end
  end

  return resultOrError(result, recognized, "info")
end

local function splitColumns(line)
  local columns = {}
  for value in (line .. "  "):gmatch("(.-)%s%s+") do
    value = trim(value:gsub("^|", ""):gsub("|$", ""))
    if value ~= "" then table.insert(columns, value) end
  end
  return columns
end

function Parsers.parseFleetRadar(input)
  local lines, err = linesFrom(input)
  if not lines then return nil, err end

  local result = {source = "fleetradar", entities = {}}
  local recognized = 0
  local columns = nil

  for _, line in ipairs(lines) do
    local lower = line:lower()
    if not isDecoration(line) then
      local header = splitColumns(line)
      if lower:find("ship", 1, true) and lower:find("position", 1, true)
          and (#header >= 2) then
        columns = {}
        for index, heading in ipairs(header) do
          local normalized = heading:lower()
          if normalized:find("leader", 1, true) then
            columns[index] = "leader"
          elseif normalized:find("position", 1, true) then
            columns[index] = "position"
          elseif normalized:find("ship", 1, true) or normalized:find("name", 1, true) then
            columns[index] = "name"
          end
        end
      elseif not lower:match("^fleet%s*radar") then
        local values = splitColumns(line)
        local entity = {kind = "ship"}
        local pipeName, pipeLeader, pipePosition = line:match(
          "^%s*(.-)%s*|%s*(.-)%s*|%s*(.-)%s*$"
        )
        if pipeName then
          entity.name = pipeName
          entity.leader = pipeLeader
          entity.position = pipePosition
        elseif columns and #values >= 2 then
          for index, value in ipairs(values) do
            if columns[index] then entity[columns[index]] = value end
          end
        else
          entity.name, entity.leader, entity.position = line:match("^(.-)%s%s+(.-)%s%s+(.+)$")
        end

        if entity.name and (entity.leader or entity.position) then
          entity.name, entity.class = parseDisplayName(trim(entity.name))
          entity.kind = classify(entity.name, entity.class)
          if entity.leader then
            entity.leader = trim(entity.leader)
            if entity.leader == "" then entity.leader = nil end
          end
          if entity.position then
            entity.position = trim(entity.position)
            local tactical, x, y, z = entity.position:match(
              "^%((.-)%)%s+([+-]?[%d,]+)%s+([+-]?[%d,]+)%s+([+-]?[%d,]+)$"
            )
            if not x then
              x, y, z = entity.position:match(
                "^([+-]?[%d,]+)%s+([+-]?[%d,]+)%s+([+-]?[%d,]+)$"
              )
            end
            if x then
              entity.x = number(x)
              entity.y = number(y)
              entity.z = number(z)
              entity.position = tactical
            end
          end
          table.insert(result.entities, entity)
          recognized = recognized + 1
        end
      end
    end
  end

  addUniqueIds(result.entities)
  return resultOrError(result, recognized, "fleetradar")
end

-- Keep the public spelling identical to the in-game command while retaining
-- the more readable internal camel-casing above.
Parsers.parseFleetradar = Parsers.parseFleetRadar

function Parsers.parse(command, input)
  if type(command) ~= "string" then
    return nil, "command must be a string"
  end

  local normalized = trim(command):lower():gsub("%s+", " ")
  local dispatch = {
    radar = Parsers.parseRadar,
    prox = Parsers.parseProx,
    proximity = Parsers.parseProx,
    ["prox velocity"] = Parsers.parseProxVelocity,
    ["proximity velocity"] = Parsers.parseProxVelocity,
    ["prox speed"] = Parsers.parseProxVelocity,
    ["proximity speed"] = Parsers.parseProxVelocity,
    status = Parsers.parseStatus,
    info = Parsers.parseInfo,
    fleetradar = Parsers.parseFleetRadar,
    ["fleetradar targets"] = Parsers.parseFleetRadar,
  }

  local parser = dispatch[normalized]
  if not parser then
    return nil, "unsupported command: " .. normalized
  end
  return parser(input)
end

return Parsers
