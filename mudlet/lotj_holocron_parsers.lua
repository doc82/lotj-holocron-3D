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
  local x, y, z =
    value:match("^%s*([+-]?[%d,]+%.?%d*)[%s,]+([+-]?[%d,]+%.?%d*)[%s,]+([+-]?[%d,]+%.?%d*)%s*$")
  if not x then
    return nil
  end
  return { x = number(x), y = number(y), z = number(z) }
end

local function amount(value)
  local current, maximum = value:match("([+-]?[%d,]+)%s*/%s*([+-]?[%d,]+)")
  if current then
    return { current = number(current), maximum = number(maximum) }
  end

  local single = value:match("([+-]?[%d,]+)")
  if single then
    return { current = number(single) }
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
  if value:find("planet", 1, true) then
    return "planet"
  end
  if value:find("moon", 1, true) then
    return "moon"
  end
  if value:find("asteroid", 1, true) then
    return "asteroid"
  end
  if
    value:find("missile", 1, true)
    or value:find("torpedo", 1, true)
    or value:find("rocket", 1, true)
    or value:find("bomb", 1, true)
  then
    return "projectile"
  end
  -- In current radar output, a quoted display name is preceded by its ship
  -- class. Do not mistake "Star Destroyer" for a stellar object.
  if class and class ~= "" then
    return "ship"
  end
  if value == "star" or value == "sun" or value:match("%sstar$") or value:match("%ssun$") then
    return "star"
  end
  return "ship"
end

local function validShipName(name)
  return type(name) == "string"
    and name ~= ""
    and #name <= 64
    and name:find("%s") == nil
    and name:find("'", 1, true) == nil
end

local function parseDisplayName(raw)
  raw = trim(raw:gsub("%s+%[[^%]]+%]%s*$", ""))
  -- Proximity output labels its value column at the end of the contact name.
  raw = trim(raw:gsub("%s+[Pp][Rr][Oo][Xx]%s*$", ""))
  raw = trim(raw:gsub("%s+[Vv][Ee][Ll][Oo][Cc][Ii][Tt][Yy]%s*$", ""))
  local class, quoted = raw:match("^(.-)%s+'(.-)'%s*$")
  if quoted then
    class = trim(class)
    quoted = trim(quoted)
    if quoted == "" or #quoted > 160 then
      return nil, nil, false
    end
    -- Player-assigned ship callsigns are one token. Celestial display names
    -- may contain spaces, so apply this restriction only to ship classes.
    if classify(quoted, class) == "ship" and not validShipName(quoted) then
      return nil, nil, false
    end
    return quoted, class, true
  end
  local lower = raw:lower()
  if
    raw == ""
    or #raw > 160
    or raw:find("'", 1, true)
    or lower:find(" enters the starsystem", 1, true)
    or lower:find("coming out of its hyperjump", 1, true)
  then
    return nil, nil, false
  end
  return raw, nil, true
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

local function radarSystemName(line)
  line = trim(tostring(line or ""))
  local explicit = line:match("^[Ss]tarsystem:%s*(.-)%s*$")
  if explicit and explicit ~= "" then
    return explicit
  end
  if line:find(":", 1, true) or not line:match("^[%w][%w%s'%-]+$") then
    return nil
  end
  local lower = line:lower()
  if lower == "uncharted space" or lower == "unknown space" then
    return line
  end
  if lower:match("%ssector$") or lower:match("%ssystem$") then
    return line
  end
  return nil
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
  if not lines then
    return nil, err
  end

  local result = { source = "radar", entities = {} }
  local recognized = 0
  local sawEntity = false

  for _, line in ipairs(lines) do
    local label, x, y, z =
      line:match("^(.-)%s+([+-]?[%d,]+%.?%d*)%s+([+-]?[%d,]+%.?%d*)%s+([+-]?[%d,]+%.?%d*)%s*$")
    if label then
      label = trim(label)
      local position = { x = number(x), y = number(y), z = number(z) }
      if label:lower():match("^your%s+coordinates%s*:") then
        result.observer = position
      else
        local name, class, validName = parseDisplayName(label)
        if validName then
          local kind = classify(name, class)
          -- Current LotJ radar output gives ships as Class 'Name', while
          -- unquoted rows are celestial contacts (for example Dromund Kaas).
          -- Radar alone cannot reliably distinguish a planet from a star.
          if not class and kind == "ship" then
            kind = "celestial"
          end
          table.insert(result.entities, {
            name = name,
            class = class,
            kind = kind,
            x = position.x,
            y = position.y,
            z = position.z,
          })
          sawEntity = true
          recognized = recognized + 1
        end
      end
      if label:lower():match("^your%s+coordinates%s*:") then
        recognized = recognized + 1
      end
    elseif not sawEntity and not result.system then
      result.system = radarSystemName(line)
    end
  end

  addUniqueIds(result.entities)
  return resultOrError(result, recognized, "radar")
end

local function parseProximity(input, velocityMode)
  local lines, err = linesFrom(input)
  if not lines then
    return nil, err
  end

  local source = velocityMode and "prox_velocity" or "prox"
  local result = { source = source, entities = {} }
  local recognized = 0

  for _, line in ipairs(lines) do
    local lower = line:lower()
    local coordinateText = line:match("^[Yy]our%s+[Cc]oordinates%s*:%s*(.+)$")
    local observer = coordinateText and vector(coordinateText) or nil
    if observer then
      result.observer = observer
      recognized = recognized + 1
    elseif
      not isDecoration(line)
      and line:sub(1, 1) ~= "{"
      and line:sub(1, 1) ~= "["
      and not lower:match("^proximity")
      and not lower:match("^object%s+")
      and not lower:match("^name%s+")
    then
      local label, value = line:match("^(.-)%s*[:|]%s*([+-]?[%d,]+%.?%d*)%s*(.-)%s*$")
      if not label then
        label, value = line:match("^(.-)%s%s+([+-]?[%d,]+%.?%d*)%s*(.-)%s*$")
      end
      if not label then
        label, value = line:match("^(.-)%s+([+-]?[%d,]+%.?%d*)%s+units?%s*$")
      end

      if label and value then
        local name, class, validName = parseDisplayName(label)
        if validName then
          local entity = { name = name, class = class, kind = classify(name, class) }
          if velocityMode then
            entity.speed = number(value)
          else
            entity.distance = number(value)
          end
          if entity.name then
            table.insert(result.entities, entity)
            recognized = recognized + 1
          end
        end
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
  ["target"] = "target",
  ["autopilot status"] = "autopilotStatus",
  ["ion condition"] = "ionCondition",
  ["launcher condition"] = "launcherCondition",
  ["escape pods"] = "escapePods",
}

local function cardSection(card, title)
  local normalized = trim(title or "OVERVIEW"):upper()
  local current = card.sections[#card.sections]
  if current and current.title == normalized then
    return current
  end
  current = { title = normalized, rows = {} }
  table.insert(card.sections, current)
  return current
end

local function linePairs(line)
  local pairsFound = {}
  local padded = line .. "  "
  local cursor = 1
  while cursor <= #line do
    local _, colon, key = padded:find("%s*([^:]+):", cursor)
    if not colon then
      break
    end
    local nextStart = padded:find("%s%s+[^:]+:", colon + 1)
    local valueEnd
    local _, _, bracketNext = padded:find("%]%s+()[%a][%w%s%(%)%-]*:", colon + 1)
    if bracketNext and (not nextStart or bracketNext < nextStart) then
      nextStart = bracketNext
    end
    -- Some status variants separate adjacent fields with a sentence-style
    -- period instead of column padding: `Total Turrets: 2. Damaged Turrets:`.
    -- Keep the period out of the first value and resume at the second label.
    local periodStart, _, periodNext = padded:find("%.%s+()[%a][%w%s%(%)%-]*:", colon + 1)
    if periodNext and (not nextStart or periodNext < nextStart) then
      nextStart = periodNext
      valueEnd = periodStart - 1
    end
    valueEnd = valueEnd or (nextStart and (nextStart - 1) or #line)
    table.insert(pairsFound, { label = trim(key), value = trim(padded:sub(colon + 1, valueEnd)) })
    if not nextStart then
      break
    end
    cursor = nextStart
  end
  return pairsFound
end

local function appendCardPairs(card, sectionTitle, line)
  local pairsFound = linePairs(line)
  if #pairsFound == 0 then
    return pairsFound
  end
  local section = cardSection(card, sectionTitle)
  for _, pair in ipairs(pairsFound) do
    table.insert(section.rows, pair)
  end
  return pairsFound
end

local function assignStatus(result, rawKey, rawValue)
  local key = trim(rawKey):lower()
  local field = STATUS_KEYS[key]
  if not field then
    local turret = key:match("^turret%s+(.+)$")
    if turret then
      result.turrets = result.turrets or {}
      table.insert(result.turrets, { name = "Turret " .. turret, condition = trim(rawValue) })
      return true
    end
    return false
  end

  local value = trim(rawValue)
  if field == "coordinates" or field == "heading" then
    local parsed = vector(value)
    if not parsed then
      return false
    end
    result[field] = parsed
  elseif
    field == "speed"
    or field == "hull"
    or field == "shields"
    or field == "energy"
    or field == "missiles"
    or field == "torpedoes"
    or field == "rockets"
    or field == "escapePods"
  then
    local parsed = amount(value)
    if not parsed then
      return false
    end
    result[field] = parsed
  else
    result[field] = value
    if field == "autopilotStatus" then
      local normalized = value:lower()
      if normalized == "online" or normalized == "active" or normalized == "on" then
        result.autopilot = true
      elseif normalized == "offline" or normalized == "inactive" or normalized == "off" then
        result.autopilot = false
      end
    end
  end
  return true
end

function Parsers.parseStatus(input)
  local lines, err = linesFrom(input)
  if not lines then
    return nil, err
  end

  -- A player command can preempt a background `info <ship>` capture while the
  -- old response is already in flight. Never reinterpret that info dossier as
  -- status output: its `Kill Markers:` section otherwise looks like the legacy
  -- `Ship Name:` status header and can corrupt the observer identity.
  for _, line in ipairs(lines) do
    if line:match("^%[Class:%s*[^%]]+%]%s*:%s*.+$") then
      return nil, "status output contained a ship information response"
    end
  end

  local result = { source = "status" }
  local card = { title = "SHIP STATUS", sections = {}, notices = {} }
  local sectionTitle = "FLIGHT"
  local recognized = 0

  for _, line in ipairs(lines) do
    local decoratedSection = line:match("^%-%-([^%-]+)%-+")
    if decoratedSection then
      sectionTitle = trim(decoratedSection)
    elseif not isDecoration(line) and not line:match("^%s*{[^}]+}") then
      local requiredSensors = line:match("[Nn]eed%s+(%d+)%s+sensors%s+to%s+scan%s+for%s+lifeforms")
      local detectedLifeforms = line:match("[Ll]ifeforms%s+detected:%s*(.+)$")
      if requiredSensors then
        result.lifeformScan = { available = false, requiredSensors = number(requiredSensors) }
        table.insert(card.notices, trim(line))
        recognized = recognized + 1
      elseif detectedLifeforms then
        result.lifeformScan = { available = true, value = trim(detectedLifeforms) }
        table.insert(card.notices, trim(line))
        recognized = recognized + 1
      elseif line:lower() == "you cannot scan your own ship for lifeforms." then
        table.insert(card.notices, trim(line))
      end
      local foundPair = false
      -- Status often prints two or more key/value pairs on one line. A new key
      -- begins after two spaces; values themselves may contain single spaces.
      local pairsFound = linePairs(line)
      for _, pair in ipairs(pairsFound) do
        if assignStatus(result, pair.label, pair.value) then
          recognized = recognized + 1
          foundPair = true
        end
      end

      if not foundPair and not result.name then
        local name = line:match("^(.-):$")
        if name and not STATUS_KEYS[name:lower()] then
          name = trim(name):gsub("^[Rr]eadout%s+for%s+", "")
          local parsedName, parsedClass, validName = parseDisplayName(name)
          if
            validName
            and classify(parsedName, parsedClass) == "ship"
            and validShipName(parsedName)
          then
            result.name, result.class = parsedName, parsedClass
            result.kind = "ship"
            result.id = slug(result.name)
            card.title = trim(line:gsub(":$", ""))
            recognized = recognized + 1
          end
        end
      end
      if
        #pairsFound > 0
        and not (not foundPair and #pairsFound == 1 and pairsFound[1].value == "" and result.name)
      then
        appendCardPairs(card, sectionTitle, line)
      end
    end
  end

  result.statusCard = card

  return resultOrError(result, recognized, "status")
end

local INFO_CARD_FIELDS = {
  OVERVIEW = {
    { source = "Quota", label = "Quota", kind = "ratio" },
    { source = "Value", label = "Value", kind = "credits" },
    { source = "Owner", label = "Owner", kind = "bracket" },
    { source = "Pilot", label = "Pilot", kind = "bracket" },
    { source = "Copilot", label = "Copilot", kind = "bracket" },
    { source = "Crew", label = "Crew", kind = "bracket" },
  },
  WEAPONS = {
    { source = "Autoblasters", label = "Autoblasters", kind = "count", weapon = "autoblasters" },
    { source = "Laser cannons", label = "Laser Cannons", kind = "count", weapon = "laserCannons" },
    { source = "Turbolasers", label = "Turbolasers", kind = "count", weapon = "turbolasers" },
    { source = "Ion cannons", label = "Ion Cannons", kind = "count", weapon = "ionCannons" },
    {
      source = "Maximum Missiles",
      label = "Maximum Missiles",
      kind = "count",
      weapon = "maximumMissiles",
    },
    {
      source = "Maximum Torpedoes",
      label = "Maximum Torpedoes",
      kind = "count",
      weapon = "maximumTorpedoes",
    },
    {
      source = "Maximum Rockets",
      label = "Maximum Rockets",
      kind = "count",
      weapon = "maximumRockets",
    },
    {
      source = "Maximum Pulses",
      label = "Maximum Pulses",
      kind = "count",
      weapon = "maximumPulses",
    },
    { source = "Maximum Chaff", label = "Maximum Chaff", kind = "count", weapon = "maximumChaff" },
    { source = "Missile Tubes", label = "Missile Tubes", kind = "count", weapon = "missileTubes" },
    { source = "Tractorbeams", label = "Tractor Beams", kind = "count" },
    { source = "Escape Pods", label = "Escape Pods", kind = "count" },
  },
  ["ACCESS CODES"] = {
    { source = "Hatchway", label = "Hatchway", kind = "count" },
    { source = "Hangar Bays", label = "Hangar Bays", kind = "count" },
    { source = "Docking", label = "Docking", kind = "count" },
    { source = "Selfdestruct", label = "Self-destruct", kind = "count" },
  },
  SYSTEMS = {
    { source = "Max Hull", label = "Maximum Hull", kind = "count" },
    { source = "Max Shields", label = "Maximum Shields", kind = "count" },
    { source = "Max Energy(fuel)", label = "Maximum Energy (fuel)", kind = "count" },
    { source = "Maximum Speed", label = "Maximum Speed", kind = "count", result = "maximumSpeed" },
    { source = "Hyperspeed", label = "Hyperspeed", kind = "count", result = "hyperspeed" },
    { source = "Maneuver", label = "Maneuver", kind = "count" },
    { source = "Sensor Array", label = "Sensor Array", kind = "count", result = "sensorArray" },
    { source = "Shield Boosters", label = "Shield Boosters", kind = "count" },
    { source = "Communications", label = "Communications", kind = "count" },
    { source = "Cloaking Device", label = "Cloaking Device", kind = "text" },
  },
}

local function validatedInfoValue(rawValue, kind)
  local value = trim(rawValue)
  if kind == "count" then
    return value:match("^([%d,]+)")
  elseif kind == "ratio" then
    local current, maximum = value:match("^([%d,%.]+)%s*/%s*([%d,%.]+)")
    return current and maximum and (current .. "/" .. maximum) or nil
  elseif kind == "credits" then
    return value:match("^([%d,%.]+%s+credit%(s%))")
  elseif kind == "bracket" then
    local contents = value:match("^%[([^%]]*)%]")
    if contents == nil then
      return nil
    end
    contents = trim(contents)
    return contents ~= "" and contents or "UNASSIGNED"
  elseif kind == "text" then
    if value == "" or #value > 80 or value:find("[{}]") or not value:find("%a") then
      return nil
    end
    return value
  end
  return nil
end

local INFO_CARD_SECTION_ORDER = { "OVERVIEW", "WEAPONS", "ACCESS CODES", "SYSTEMS" }

local function validatedInfoFields(definitions, line)
  if not definitions then
    return {}
  end
  local lower = line:lower()
  local fields = {}
  for _, definition in ipairs(definitions) do
    local needle = definition.source:lower() .. ":"
    local searchAt = 1
    local startAt, endAt
    repeat
      startAt, endAt = lower:find(needle, searchAt, true)
      if not startAt then
        searchAt = #lower + 1
      elseif startAt > 1 and lower:sub(startAt - 1, startAt - 1):find("[%w]") then
        searchAt = endAt + 1
        startAt, endAt = nil, nil
      end
    until startAt or searchAt > #lower
    if startAt then
      table.insert(fields, { startAt = startAt, endAt = endAt, definition = definition })
    end
  end
  table.sort(fields, function(left, right)
    return left.startAt < right.startAt
  end)
  return fields
end

local function appendValidatedInfoPairs(card, sectionTitle, line)
  local resolvedSection = sectionTitle
  local fields = validatedInfoFields(INFO_CARD_FIELDS[resolvedSection], line)
  if #fields == 0 then
    for _, candidate in ipairs(INFO_CARD_SECTION_ORDER) do
      if candidate ~= sectionTitle then
        fields = validatedInfoFields(INFO_CARD_FIELDS[candidate], line)
        if #fields > 0 then
          resolvedSection = candidate
          break
        end
      end
    end
  end
  local accepted = {}
  for index, field in ipairs(fields) do
    local nextField = fields[index + 1]
    local rawValue = line:sub(field.endAt + 1, nextField and nextField.startAt - 1 or #line)
    local value = validatedInfoValue(rawValue, field.definition.kind)
    if value then
      local pair = { label = field.definition.label, value = value }
      table.insert(cardSection(card, resolvedSection).rows, pair)
      table.insert(accepted, { definition = field.definition, value = value })
    end
  end
  return accepted
end

local function normalizedInfoDescription(lines)
  local paragraph = table.concat(lines, " "):gsub("%s+", " ")
  paragraph = trim(paragraph):gsub("%s+([,%.%!%?%;:])", "%1")
  return paragraph ~= "" and paragraph or nil
end

function Parsers.parseInfo(input)
  local lines, err = linesFrom(input)
  if not lines then
    return nil, err
  end

  local result = { source = "info" }
  local card = { title = "SHIP INFORMATION", sections = {} }
  local sectionTitle = "OVERVIEW"
  local headerFound = false
  local descriptionOpen = false
  local descriptionLines = {}
  local recognized = 0
  local weapons = {}

  for _, line in ipairs(lines) do
    local decoratedSection = line:match("^%-%-([^%-]+)%-+")
    local normalizedSection = decoratedSection and trim(decoratedSection):upper() or nil
    if normalizedSection and INFO_CARD_FIELDS[normalizedSection] then
      sectionTitle = normalizedSection
      descriptionOpen = false
    elseif trim(line):lower():match("^kill markers:") then
      sectionTitle = "OVERVIEW"
      descriptionOpen = false
    else
      local category, displayName = line:match("^%[Class:%s*([^%]]+)%]%s*:%s*(.+)$")
      category = category and trim(category) or ""
      displayName = displayName and trim(displayName) or ""
      local validHeader = category ~= ""
        and displayName ~= ""
        and #category <= 60
        and #displayName <= 160
        and not category:find("[{}:]")
        and not displayName:find("[{}]")
      local parsedName, parsedClass, validName = parseDisplayName(displayName)
      if
        validHeader
        and validName
        and classify(parsedName, parsedClass) == "ship"
        and validShipName(parsedName)
      then
        result.shipCategory = category
        result.name, result.class = parsedName, parsedClass
        result.kind = "ship"
        result.id = slug(result.name)
        headerFound = true
        descriptionOpen = true
        recognized = recognized + 1
      elseif headerFound and not decoratedSection and not isDecoration(line) then
        local accepted = appendValidatedInfoPairs(card, sectionTitle, line)
        for _, field in ipairs(accepted) do
          local definition = field.definition
          if definition.weapon then
            weapons[definition.weapon] = math.max(0, number(field.value) or 0)
          elseif definition.result then
            result[definition.result] = math.max(0, number(field.value) or 0)
          end
          recognized = recognized + 1
        end
        if #accepted == 0 and descriptionOpen then
          local prose = trim(line):gsub("^[%d,%.]+%s+", "")
          local validProse = prose ~= ""
            and prose:find("%a")
            and not prose:find("[{}]")
            and not prose:find(":")
          if validProse then
            table.insert(descriptionLines, prose)
          end
        end
      end
    end
  end

  card.description = normalizedInfoDescription(descriptionLines)
  if card.description then
    recognized = recognized + 1
  end
  if not headerFound or recognized < 2 then
    return nil, "info output did not contain a validated ship header and body"
  end
  if result.sensorArray then
    result.radarRange = 500 + (result.sensorArray * 10)
  end
  if next(weapons) then
    result.weapons = weapons
    local requiredWeaponFields = {
      "autoblasters",
      "laserCannons",
      "turbolasers",
      "ionCannons",
      "maximumMissiles",
      "maximumTorpedoes",
      "maximumRockets",
      "maximumPulses",
      "missileTubes",
    }
    local complete = true
    for _, field in ipairs(requiredWeaponFields) do
      if weapons[field] == nil then
        complete = false
        break
      end
    end
    if complete then
      local launchersArmed = weapons.missileTubes > 0
        and (
          weapons.maximumMissiles > 0
          or weapons.maximumTorpedoes > 0
          or weapons.maximumRockets > 0
          or weapons.maximumPulses > 0
        )
      result.hasWeapons = weapons.autoblasters > 0
        or weapons.laserCannons > 0
        or weapons.turbolasers > 0
        or weapons.ionCannons > 0
        or launchersArmed
    end
  end

  result.infoCard = card
  return resultOrError(result, recognized, "info")
end

local function durationSeconds(value)
  value = trim(value or "")
  local minutes, seconds = value:match("^(%d+)m%s+(%d+)s$")
  if minutes then
    return tonumber(minutes) * 60 + tonumber(seconds)
  end
  seconds = value:match("^(%d+)s$")
  return seconds and tonumber(seconds) or nil
end

function Parsers.parseNavstat(input)
  local lines, err = linesFrom(input)
  if not lines then
    return nil, err
  end
  local result = { source = "navstat" }
  local recognized = 0
  for _, line in ipairs(lines) do
    local coordinates = line:match("^[Cc]urrent%s+[Cc]oordinates:%s*(.+)$")
    local heading = line:match("^[Cc]urrent%s+[Hh]eading:%s*(.+)$")
    local speed = line:match("^[Cc]urrent%s+[Ss]peed:%s*(.+)$")
    local system = line:match("^[Cc]urrent%s+[Ss]ystem:%s*(.+)$")
    local galaxyX, galaxyY =
      line:match("^[Cc]urrent%s+[Ss]ystem%s+X/Y:%s*%(([+-]?%d+),%s*([+-]?%d+)%)")
    local jumpSystem = line:match("^[Jj]ump%s+[Ss]ystem:%s*(.+)$")
    local jumpDistance = line:match("^[Jj]ump%s+[Dd]istance:%s*([%d,.]+)%s+parsecs")
    local jumpTime = line:match("^[Jj]ump%s+[Tt]ime:%s*(.+)$")
    if coordinates and vector(coordinates) then
      result.coordinates = vector(coordinates)
      recognized = recognized + 1
    elseif heading and vector(heading) then
      result.heading = vector(heading)
      recognized = recognized + 1
    elseif speed and amount(speed) then
      result.speed = amount(speed)
      recognized = recognized + 1
    elseif system then
      result.system = trim(system)
      recognized = recognized + 1
    elseif galaxyX then
      result.galaxy = { x = number(galaxyX), y = number(galaxyY) }
      recognized = recognized + 1
    elseif jumpSystem then
      result.jumpSystem = trim(jumpSystem)
      recognized = recognized + 1
    elseif jumpDistance then
      result.jumpDistanceParsecs = number(jumpDistance)
      recognized = recognized + 1
    elseif jumpTime then
      result.jumpTime = trim(jumpTime)
      result.jumpTimeSeconds = durationSeconds(result.jumpTime)
      recognized = recognized + 1
    elseif line:find("jump to all standard sectors", 1, true) then
      result.standardSectorsAvailable = true
      recognized = recognized + 1
    end
  end
  return resultOrError(result, recognized, "navstat")
end

function Parsers.parseCalculate(input)
  local lines, err = linesFrom(input)
  if not lines then
    return nil, err
  end
  local result = { source = "calculate", destinations = {} }
  local recognized = 0
  for _, line in ipairs(lines) do
    local remaining =
      line:match("^[Cc]alculating%s+[Hh]yperspace%s+[Tt]rajectory:%s*(%d+)%s+seconds%s+remaining")
    if remaining then
      result.mode = "status"
      result.remainingSeconds = tonumber(remaining)
      recognized = recognized + 1
    elseif line:find("Possible destinations:", 1, true) then
      result.mode = "destinations"
    elseif not line:match("^Starsystem%s+") then
      local name, parsecs = line:match("^(.-)%s+([%d,.]+)%s+%(Out of Range%)%s*$")
      if name then
        table.insert(result.destinations, {
          system = trim(name),
          distanceParsecs = number(parsecs),
          reachable = false,
        })
        result.mode = "destinations"
        recognized = recognized + 1
      else
        local reachableName, reachableParsecs, time, fuel =
          line:match("^(.-)%s+([%d,.]+)%s+([%dsmh%s]+)%s+([%d]+)%%%s*$")
        if reachableName then
          time = trim(time)
          table.insert(result.destinations, {
            system = trim(reachableName),
            distanceParsecs = number(reachableParsecs),
            travelTime = time,
            travelTimeSeconds = durationSeconds(time),
            fuelPercent = tonumber(fuel),
            reachable = true,
          })
          result.mode = "destinations"
          recognized = recognized + 1
        end
      end
    end
  end
  return resultOrError(result, recognized, "calculate")
end

local function splitColumns(line)
  local columns = {}
  for value in (line .. "  "):gmatch("(.-)%s%s+") do
    value = trim(value:gsub("^|", ""):gsub("|$", ""))
    if value ~= "" then
      table.insert(columns, value)
    end
  end
  return columns
end

function Parsers.parseFleetRadar(input)
  local lines, err = linesFrom(input)
  if not lines then
    return nil, err
  end

  local result = { source = "fleetradar", entities = {} }
  local recognized = 0
  local columns = nil
  local currentGroup = nil

  for _, line in ipairs(lines) do
    local lower = line:lower()
    if not isDecoration(line) then
      local system = radarSystemName(line)
      local header = splitColumns(line)
      if system then
        result.system = system
        recognized = recognized + 1
      elseif lower:match("battlegroup:%s*$") then
        currentGroup = line:match("'([^']+)'s%s+[Bb]attlegroup:%s*$")
          or trim(line:gsub("['’]s%s+[Bb]attlegroup:%s*$", ""))
      elseif lower:find("ship", 1, true) and lower:find("position", 1, true) and (#header >= 2) then
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
        local entity = { kind = "ship" }
        local coordinateName, tactical, x, y, z =
          line:match("^(.-)%s+%((.-)%)%s+([+-]?[%d,]+)%s+([+-]?[%d,]+)%s+([+-]?[%d,]+)%s*$")
        if not coordinateName then
          coordinateName, x, y, z =
            line:match("^(.-)%s+([+-]?[%d,]+)%s+([+-]?[%d,]+)%s+([+-]?[%d,]+)%s*$")
        end
        local pipeName, pipeLeader, pipePosition = line:match("^%s*(.-)%s*|%s*(.-)%s*|%s*(.-)%s*$")
        if pipeName then
          entity.name = pipeName
          entity.leader = pipeLeader
          entity.position = pipePosition
        elseif coordinateName then
          coordinateName = trim(coordinateName)
          if coordinateName:lower():match("^your%s+coordinates%s*:") then
            result.observer = { x = number(x), y = number(y), z = number(z) }
            recognized = recognized + 1
          else
            entity.name = coordinateName
            entity.leader = currentGroup
            entity.position = tactical
            entity.x, entity.y, entity.z = number(x), number(y), number(z)
          end
        elseif columns and #values >= 2 then
          for index, value in ipairs(values) do
            if columns[index] then
              entity[columns[index]] = value
            end
          end
        else
          entity.name, entity.leader, entity.position = line:match("^(.-)%s%s+(.-)%s%s+(.+)$")
        end

        if
          entity.name
          and (
            entity.leader
            or entity.position
            or entity.x ~= nil
            or entity.y ~= nil
            or entity.z ~= nil
          )
        then
          local parsedName, parsedClass, validName = parseDisplayName(trim(entity.name))
          if validName then
            entity.name, entity.class = parsedName, parsedClass
            entity.kind = classify(entity.name, entity.class)
            if entity.kind == "ship" and not validShipName(entity.name) then
              entity.name = nil
            end
          else
            entity.name = nil
          end
          if entity.leader then
            entity.leader = trim(entity.leader)
            if entity.leader == "" then
              entity.leader = nil
            end
          end
          if entity.position then
            entity.position = trim(entity.position)
            local tactical, x, y, z =
              entity.position:match("^%((.-)%)%s+([+-]?[%d,]+)%s+([+-]?[%d,]+)%s+([+-]?[%d,]+)$")
            if not x then
              x, y, z = entity.position:match("^([+-]?[%d,]+)%s+([+-]?[%d,]+)%s+([+-]?[%d,]+)$")
            end
            if x then
              entity.x = number(x)
              entity.y = number(y)
              entity.z = number(z)
              entity.position = tactical
            end
          end
          if entity.name then
            table.insert(result.entities, entity)
            recognized = recognized + 1
          end
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

local function percentReading(value)
  local parsed = number(tostring(value or ""):match("([%d,.]+)%%"))
  if parsed == nil then
    return nil
  end
  return { current = parsed, maximum = 100 }
end

local function inactiveFormation(kind, line)
  local lower = tostring(line or ""):lower()
  if not lower:find(kind, 1, true) then
    return nil
  end
  if
    lower:find("not ", 1, true)
    or lower:find("no ", 1, true)
    or lower:find("aren't", 1, true)
    or lower:find("isn't", 1, true)
  then
    return {
      source = kind,
      fleet = { kind = kind, active = false, members = {} },
      recognizedLines = 1,
    }
  end
  return nil
end

function Parsers.parseBattlegroup(input)
  local lines, err = linesFrom(input)
  if not lines then
    return nil, err
  end

  local result = {
    source = "battlegroup",
    fleet = {
      kind = "battlegroup",
      active = true,
      members = {},
    },
  }
  local recognized = 0
  local current = nil

  for _, line in ipairs(lines) do
    local inactive = inactiveFormation("battlegroup", line)
    if inactive then
      return inactive
    end

    local slot, category, display, position =
      line:match("^%[%s*([^%]]-)%s*%]%s*(.-)%s*:%s*(.-)%s+%-<Pos:([^>]*)>%-%s*$")
    if slot then
      local normalizedSlot = trim(slot)
      local leader = normalizedSlot:lower() == "l"
      local name, class, validName = parseDisplayName(trim(display))
      if validName and classify(name, class) == "ship" and validShipName(name) then
        current = {
          id = slug(name),
          name = name,
          class = class,
          shipCategory = trim(category),
          role = leader and "leader" or "wing",
          leader = leader,
          slot = leader and nil or tonumber(normalizedSlot),
          position = trim(position),
          presence = "active",
        }
        table.insert(result.fleet.members, current)
        if leader then
          result.fleet.leaderId = current.id
        end
        recognized = recognized + 1
      else
        current = nil
      end
    elseif current then
      local energy, hull, shields, crew, system, gx, gy = line:match(
        "^Energy:%s*([%d,.]+)%%%s*|Hull:%s*([%d,.]+)%%%s*|Shields:%s*([%d,.]+)%%%s*|Crew:%s*([%d,]+)%s*|System:%s*(.-)%s+([+-]?[%d,]+)%s*/%s*([+-]?[%d,]+)%s*$"
      )
      if energy then
        current.energy = percentReading(energy .. "%")
        current.hull = percentReading(hull .. "%")
        current.shields = percentReading(shields .. "%")
        current.crew = number(crew)
        current.system = trim(system)
        current.galaxy = { x = number(gx), y = number(gy) }
        recognized = recognized + 1
      end
    end
  end

  result.fleet.memberCount = #result.fleet.members
  return resultOrError(result, recognized, "battlegroup")
end

function Parsers.parseSquadronStatus(input)
  local lines, err = linesFrom(input)
  if not lines then
    return nil, err
  end

  local result = {
    source = "squadron",
    fleet = {
      kind = "squadron",
      active = true,
      members = {},
    },
  }
  local recognized = 0
  local current = nil

  for _, line in ipairs(lines) do
    local inactive = inactiveFormation("squadron", line)
    if inactive then
      return inactive
    end

    local assist, aim =
      line:match("^[Ss]quadron%s+[Ff]ire%s+[Aa]ssist:%s*(%S+)%s+[Ss]ystems%s+[Tt]arget:%s*(.-)%s*$")
    if assist then
      result.fleet.assist = trim(assist):lower() == "active"
      result.fleet.aimSystem = trim(aim)
      recognized = recognized + 1
    else
      local leadDisplay = line:match("^[Ll]ead:%s*(.-)%s*$")
      local memberDisplay = not leadDisplay and line:match("^(.+%s+'.-')%s*$") or nil
      if leadDisplay or memberDisplay then
        local name, class, validName = parseDisplayName(trim(leadDisplay or memberDisplay))
        local leader = leadDisplay ~= nil
        if validName and classify(name, class) == "ship" and validShipName(name) then
          current = {
            id = slug(name),
            name = name,
            class = class,
            role = leader and "lead" or "wing",
            leader = leader,
            presence = "active",
          }
          table.insert(result.fleet.members, current)
          if leader then
            result.fleet.leaderId = current.id
          end
          recognized = recognized + 1
        else
          current = nil
        end
      elseif current then
        local energy, shields, hull, location = line:match(
          "^Energy:%s*([%d,.]+)%%%s+Shield:%s*([%d,.]+)%%%s+Hull:%s*([%d,.]+)%%%s+Location:%s*(.-)%s*$"
        )
        if energy then
          current.energy = percentReading(energy .. "%")
          current.shields = percentReading(shields .. "%")
          current.hull = percentReading(hull .. "%")
          current.location = trim(location)
          current.presence = current.location:lower() == "landed" and "landed" or "active"
          recognized = recognized + 1
        end
      end
    end
  end

  result.fleet.memberCount = #result.fleet.members
  return resultOrError(result, recognized, "squadron status")
end

function Parsers.parse(command, input)
  if type(command) ~= "string" then
    return nil, "command must be a string"
  end

  local normalized = trim(command):lower():gsub("%s+", " ")
  local dispatch = {
    radar = Parsers.parseRadar,
    ["radar projectiles"] = Parsers.parseRadar,
    prox = Parsers.parseProx,
    proximity = Parsers.parseProx,
    ["prox velocity"] = Parsers.parseProxVelocity,
    ["proximity velocity"] = Parsers.parseProxVelocity,
    ["prox speed"] = Parsers.parseProxVelocity,
    ["proximity speed"] = Parsers.parseProxVelocity,
    status = Parsers.parseStatus,
    info = Parsers.parseInfo,
    navstat = Parsers.parseNavstat,
    calc = Parsers.parseCalculate,
    calculate = Parsers.parseCalculate,
    fleetradar = Parsers.parseFleetRadar,
    ["fleetradar targets"] = Parsers.parseFleetRadar,
    battlegroup = Parsers.parseBattlegroup,
    bg = Parsers.parseBattlegroup,
    ["squadron status"] = Parsers.parseSquadronStatus,
  }

  local parser = dispatch[normalized]
  if not parser then
    return nil, "unsupported command: " .. normalized
  end
  return parser(input)
end

return Parsers
