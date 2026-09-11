local data = require("lotj_holocron_topology_data")
local Topology = {}
local function key(value)
  return tostring(value or ""):lower():gsub("^%s+", ""):gsub("%s+$", "")
end
local function contains(values, value)
  for _, item in ipairs(values) do
    if item == value then
      return true
    end
  end
  return false
end
local function node(value)
  for _, n in ipairs(data.nodes) do
    if key(value) == key(n.id) or key(value) == key(n.name) or key(value) == key(n.system) then
      return n
    end
    for _, alias in ipairs(n.aliases) do
      if key(alias) == key(value) then
        return n
      end
    end
  end
end
local function members(id)
  return data.regions[id] and data.regions[id].members or { id }
end
local function endpoint(value, id, monitor)
  local n = node(value)
  return key(value) == key(monitor)
    or key(value) == key(data.regions[id] and data.regions[id].name or id)
    or (n and n.id == id)
end
function Topology.canJump(from, to, lanes, manual)
  local a, b = node(from.name), node(to.name)
  if not a or not b or a.id == b.id then
    return false
  end
  local controlled = false
  for _, c in ipairs(data.temporaryControls) do
    if
      (contains(members(c.from), a.id) and contains(members(c.to), b.id))
      or (contains(members(c.from), b.id) and contains(members(c.to), a.id))
    then
      controlled = true
      local found = false
      for _, lane in ipairs(lanes or {}) do
        if
          (endpoint(lane.from, c.from, c.monitor[1]) and endpoint(lane.to, c.to, c.monitor[2]))
          or (endpoint(lane.to, c.from, c.monitor[1]) and endpoint(lane.from, c.to, c.monitor[2]))
        then
          if lane.status ~= "passable" then
            return false
          end
          found = true
        end
      end
      if not found then
        return false
      end
    end
  end
  if controlled then
    return true
  end
  for _, e in ipairs(data.permanentEdges) do
    if e.from == a.id and e.to == b.id then
      return true
    end
  end
  if manual ~= true then
    return false
  end
  for _, o in ipairs(data.observations) do
    if o.from == a.id and o.to == b.id and o.status == "No Path" then
      return false
    end
  end
  return true
end
return Topology
