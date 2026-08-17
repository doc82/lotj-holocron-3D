local Fixture = {}

local globalNames = {
  "registerAnonymousEventHandler",
  "tempRegexTrigger",
  "tempPromptTrigger",
  "tempTimer",
  "tempTrigger",
  "killAnonymousEventHandler",
  "killTrigger",
  "killTimer",
  "send",
  "sendGMCP",
  "deleteLine",
  "denyCurrentSend",
  "echo",
  "cecho",
  "line",
  "gmcp",
  "lotj",
}

local function copyGlobals()
  local values = {}
  for _, name in ipairs(globalNames) do
    values[name] = _G[name]
  end
  return values
end

local function restoreGlobals(values)
  for _, name in ipairs(globalNames) do
    _G[name] = values[name]
  end
end

function Fixture.new(options)
  options = options or {}
  local self = {
    originalGlobals = copyGlobals(),
    nextId = 0,
    events = {},
    triggers = {},
    timers = {},
    commands = {},
    gmcpRequests = {},
    snapshots = {},
    spaceStates = {},
    diagnostics = {},
    intentHandlers = {},
    intentAcks = {},
    deletedLines = 0,
    deniedSends = 0,
  }
  local function id(prefix)
    self.nextId = self.nextId + 1
    return prefix .. tostring(self.nextId)
  end

  _G.lotj = options.lotj or { chat = {}, systemMap = {} }
  _G.gmcp = options.gmcp or {}
  _G.line = ""
  _G.registerAnonymousEventHandler = function(eventName, callback)
    local value = id("event-")
    self.events[value] = { eventName = eventName, callback = callback }
    return value
  end
  _G.tempRegexTrigger = function(pattern, callback)
    local value = id("regex-")
    self.triggers[value] = { pattern = pattern, callback = callback }
    return value
  end
  _G.tempPromptTrigger = function(callback)
    local value = id("prompt-")
    self.triggers[value] = { pattern = "prompt", callback = callback }
    return value
  end
  _G.tempTrigger = function(pattern, callback)
    local value = id("trigger-")
    self.triggers[value] = { pattern = pattern, callback = callback }
    return value
  end
  _G.tempTimer = function(seconds, callback)
    local value = id("timer-")
    self.timers[value] = { seconds = seconds, callback = callback }
    return value
  end
  _G.killAnonymousEventHandler = function(value)
    self.events[value] = nil
    return true
  end
  _G.killTrigger = function(value)
    self.triggers[value] = nil
    return true
  end
  _G.killTimer = function(value)
    self.timers[value] = nil
    return true
  end
  _G.send = function(command, echoInput)
    table.insert(self.commands, { command = command, echo = echoInput })
    return true
  end
  _G.sendGMCP = function(command, payload)
    table.insert(self.gmcpRequests, { command = command, payload = payload })
    return true
  end
  _G.deleteLine = function()
    self.deletedLines = self.deletedLines + 1
  end
  _G.denyCurrentSend = function()
    self.deniedSends = self.deniedSends + 1
  end
  _G.echo = function() end
  _G.cecho = function() end

  package.loaded.lotj_holocron_parsers = nil
  package.loaded.lotj_holocron_scraper = nil
  self.parsers = require("lotj_holocron_parsers")
  self.scraper = require("lotj_holocron_scraper")
  self.proxy = {}
  self.proxy.parseGameOutput = function(command, output)
    return self.parsers.parse(command, output)
  end
  self.proxy.publishSnapshot = function(observer, entities, metadata)
    table.insert(self.snapshots, { observer = observer, entities = entities, metadata = metadata })
    return true
  end
  self.proxy.publishSpaceState = function(inSpace, reason)
    table.insert(self.spaceStates, { inSpace = inSpace, reason = reason })
    return true
  end
  self.proxy.onDiagnostic = function(level, message)
    table.insert(self.diagnostics, { level = level, message = message })
  end
  self.proxy.registerIntentHandler = function(action, handler)
    self.intentHandlers[action] = handler
    return true
  end
  self.proxy.publishIntentAck = function(intentId, status, reason)
    table.insert(self.intentAcks, { id = intentId, status = status, reason = reason })
    return true
  end
  assert(self.scraper.setup(self.proxy, { polling = options.polling == true and {} or false }))

  function self:capture(command, output, sentCommand)
    assert(self.scraper.startCapture(command, sentCommand or command, { polled = false }))
    for value in (output .. "\n"):gmatch("(.-)\n") do
      self.scraper.captureLine(value)
    end
    if self.scraper.active then
      return self.scraper.finishCapture("fixture")
    end
    return self.scraper.lastCapture ~= nil
  end
  function self:entity(name)
    for _, entity in pairs(self.scraper.state.entities or {}) do
      if entity.name == name then
        return entity
      end
    end
    return nil
  end
  function self:lastCommand()
    return self.commands[#self.commands]
  end
  function self:lastSnapshot()
    return self.snapshots[#self.snapshots]
  end
  function self:tick(timerId)
    local timer = self.timers[timerId]
    assert(timer, "timer is not active: " .. tostring(timerId))
    timer.callback()
  end
  function self:trigger(pattern, text)
    for _, trigger in pairs(self.triggers) do
      if trigger.pattern == pattern then
        _G.line = text or pattern
        trigger.callback()
        return true
      end
    end
    return false
  end
  function self:close()
    if self.scraper then
      self.scraper.teardown()
    end
    restoreGlobals(self.originalGlobals)
  end
  return self
end

return Fixture
