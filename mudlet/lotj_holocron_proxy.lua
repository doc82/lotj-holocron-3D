-- LotJ Holocron 3D - Mudlet process proxy
-- Lua 5.1 / Mudlet with spawn() support

local Proxy = {
  VERSION = "0.1.5",
  PROTOCOL_VERSION = 1,
  MAX_BUFFER_BYTES = 1024 * 1024,
  MAX_LINE_BYTES = 256 * 1024,
  MAX_SEEN_INTENTS = 2048,
  process = nil,
  readBuffer = "",
  sequence = 0,
  intentHandlers = {},
  seenIntentIds = {},
  seenIntentOrder = {},
  onDiagnostic = nil,
  onReady = nil,
}

local parsersLoaded, parsersOrError = pcall(require, "lotj_holocron_parsers")
if parsersLoaded then
  Proxy.parsers = parsersOrError
end

local function diagnostic(level, message)
  if type(Proxy.onDiagnostic) == "function" then
    local ok = pcall(Proxy.onDiagnostic, level, message)
    if ok then
      return
    end
  end

  if type(debugc) == "function" then
    debugc(string.format("[Holocron3D/%s] %s", level, message))
  end
end

local function encode(message)
  if not yajl or type(yajl.to_string) ~= "function" then
    return nil, "Mudlet's yajl.to_string() is unavailable"
  end

  local ok, result = pcall(yajl.to_string, message)
  if not ok then
    return nil, tostring(result)
  end

  return result
end

local function decode(raw)
  if not yajl or type(yajl.to_value) ~= "function" then
    return nil, "Mudlet's yajl.to_value() is unavailable"
  end

  local ok, result = pcall(yajl.to_value, raw)
  if not ok then
    return nil, tostring(result)
  end

  if type(result) ~= "table" then
    return nil, "message must decode to a JSON object"
  end

  return result
end

function Proxy.isRunning()
  if not Proxy.process or type(Proxy.process.isRunning) ~= "function" then
    return false
  end

  local ok, running = pcall(Proxy.process.isRunning)
  return ok and running == true
end

function Proxy.sendMessage(message)
  if type(message) ~= "table" then
    return nil, "message must be a table"
  end

  if not Proxy.isRunning() then
    return nil, "bridge process is not running"
  end

  message.v = message.v or Proxy.PROTOCOL_VERSION

  local raw, encodeError = encode(message)
  if not raw then
    return nil, encodeError
  end

  if #raw > Proxy.MAX_LINE_BYTES then
    return nil, "encoded message exceeds MAX_LINE_BYTES"
  end

  local ok, sendResult, sendError = pcall(Proxy.process.send, raw .. "\n")
  if not ok then
    return nil, tostring(sendResult)
  end
  -- Mudlet versions differ on whether process.send() returns a value. An
  -- explicit false is failure; nil with a successful call is treated as void.
  if sendResult == false then
    return nil, tostring(sendError or "process send failed")
  end

  return true
end

local function sendIntentAck(id, status, reason)
  local ack = {
    type = "intent_ack",
    id = id,
    status = status,
  }
  if reason then
    ack.reason = reason
  end

  local ok, err = Proxy.sendMessage(ack)
  if not ok then
    diagnostic("error", "could not send intent acknowledgement: " .. tostring(err))
  end
end

function Proxy.publishIntentAck(id, status, reason)
  if type(id) ~= "string" or id == "" then return nil, "intent id is required" end
  if status ~= "accepted" and status ~= "rejected" and status ~= "completed" then
    return nil, "invalid intent status"
  end
  sendIntentAck(id, status, reason)
  return true
end

local function validateIntent(message)
  if type(message.id) ~= "string" or message.id == "" then
    return nil, "intent id must be a non-empty string"
  end
  if #message.id > 128 then
    return nil, "intent id is too long"
  end
  if type(message.action) ~= "string" or message.action == "" then
    return nil, "intent action must be a non-empty string"
  end
  if type(message.payload) ~= "nil" and type(message.payload) ~= "table" then
    return nil, "intent payload must be an object"
  end
  if Proxy.seenIntentIds[message.id] then
    return nil, "duplicate intent id"
  end

  return true
end

local function handleIntent(message)
  local valid, validationError = validateIntent(message)
  if not valid then
    sendIntentAck(message.id or "", "rejected", validationError)
    return
  end

  -- Mark the ID before invoking user code so a re-entrant message cannot replay it.
  Proxy.seenIntentIds[message.id] = true
  table.insert(Proxy.seenIntentOrder, message.id)
  if #Proxy.seenIntentOrder > Proxy.MAX_SEEN_INTENTS then
    local expiredId = table.remove(Proxy.seenIntentOrder, 1)
    Proxy.seenIntentIds[expiredId] = nil
  end

  local handler = Proxy.intentHandlers[message.action]
  if type(handler) ~= "function" then
    sendIntentAck(message.id, "rejected", "unknown or disabled action")
    return
  end

  local ok, accepted, reason = pcall(handler, message.payload or {}, message)
  if not ok then
    diagnostic("error", "intent handler failed for " .. message.action .. ": " .. tostring(accepted))
    sendIntentAck(message.id, "rejected", "local intent handler failed")
    return
  end

  if accepted == false or accepted == nil then
    sendIntentAck(message.id, "rejected", tostring(reason or "intent was declined"))
    return
  end

  sendIntentAck(message.id, "accepted")
end

function Proxy.handleMessage(message)
  if message.v ~= Proxy.PROTOCOL_VERSION then
    diagnostic("warn", "rejected message with unsupported protocol version")
    if message.type == "intent" then
      sendIntentAck(message.id or "", "rejected", "unsupported protocol version")
    end
    return
  end

  if message.type == "ready" then
    Proxy.websocketUrl = message.websocketUrl
    Proxy.rendererUrl = message.rendererUrl
    Proxy.renderer = message.renderer
    diagnostic("info", "bridge is ready: " .. tostring(message.bridge or "unnamed"))
    if type(Proxy.onReady) == "function" then
      local ok, err = pcall(Proxy.onReady, message)
      if not ok then
        diagnostic("error", "onReady callback failed: " .. tostring(err))
      end
    end
    if Proxy.scraper then
      if type(Proxy.scraper.requestShipGmcpSupport) == "function" then
        pcall(Proxy.scraper.requestShipGmcpSupport)
      end
      if type(Proxy.scraper.publishGalaxyCatalog) == "function" then
        pcall(Proxy.scraper.publishGalaxyCatalog)
      end
    end
    return
  end

  if message.type == "intent" then
    handleIntent(message)
    return
  end

  if message.type == "automation_lease" then
    if Proxy.scraper and type(Proxy.scraper.refreshAutomationLease) == "function" then
      Proxy.scraper.refreshAutomationLease(tonumber(message.expiresInSeconds) or 6)
    end
    return
  end

  if message.type == "snapshot_received" then
    if not message.polled then
      diagnostic("info", "bridge received snapshot " .. tostring(message.sequence))
    end
    return
  end

  if message.type == "space_state_received" then
    diagnostic("info", "bridge received space state: "
      .. (message.inSpace and "in space" or "landed"))
    return
  end


  if message.type == "bridge_diagnostic" then
    diagnostic(tostring(message.level or "info"), tostring(message.message or ""))
    return
  end

  diagnostic("warn", "ignored unknown bridge message type: " .. tostring(message.type))
end

function Proxy.handleProcessOutput(chunk)
  if type(chunk) ~= "string" or chunk == "" then
    return
  end

  Proxy.readBuffer = Proxy.readBuffer .. chunk
  if #Proxy.readBuffer > Proxy.MAX_BUFFER_BYTES then
    Proxy.readBuffer = ""
    diagnostic("error", "bridge input exceeded MAX_BUFFER_BYTES and was discarded")
    return
  end

  while true do
    local newline = Proxy.readBuffer:find("\n", 1, true)
    if not newline then
      break
    end

    local raw = Proxy.readBuffer:sub(1, newline - 1)
    Proxy.readBuffer = Proxy.readBuffer:sub(newline + 1)
    if raw:sub(-1) == "\r" then
      raw = raw:sub(1, -2)
    end

    if #raw > Proxy.MAX_LINE_BYTES then
      diagnostic("error", "oversized bridge message was discarded")
    elseif raw ~= "" then
      local message, decodeError = decode(raw)
      if message then
        Proxy.handleMessage(message)
      else
        diagnostic("error", "invalid bridge JSON: " .. tostring(decodeError))
      end
    end
  end
end

function Proxy.start(program, arguments)
  if Proxy.isRunning() then
    return true
  end
  if type(program) ~= "string" or program == "" then
    return nil, "program must be a non-empty string"
  end
  if type(arguments) ~= "nil" and type(arguments) ~= "table" then
    return nil, "arguments must be an array table"
  end
  if type(spawn) ~= "function" then
    return nil, "Mudlet spawn() is unavailable; version 4.11 or newer is required"
  end

  Proxy.readBuffer = ""
  Proxy.seenIntentIds = {}
  Proxy.seenIntentOrder = {}
  local args = arguments or {}
  local ok, processOrError = pcall(spawn, Proxy.handleProcessOutput, program, unpack(args))
  if not ok then
    return nil, tostring(processOrError)
  end
  if type(processOrError) ~= "table" then
    return nil, "spawn() did not return a process handle"
  end

  Proxy.process = processOrError

  local sent, sendError = Proxy.sendMessage({
    type = "hello",
    source = "mudlet",
    proxyVersion = Proxy.VERSION,
  })
  if not sent then
    if type(Proxy.process.close) == "function" then
      pcall(Proxy.process.close)
    end
    Proxy.process = nil
    return nil, "bridge spawned but hello could not be sent: " .. tostring(sendError)
  end

  return true
end

function Proxy.stop()
  if Proxy.scraper and type(Proxy.scraper.teardown) == "function" then
    pcall(Proxy.scraper.teardown)
  end

  if not Proxy.process then
    return true
  end

  if Proxy.isRunning() then
    Proxy.sendMessage({type = "shutdown"})
  end
  if type(Proxy.process.close) == "function" then
    pcall(Proxy.process.close)
  end

  Proxy.process = nil
  Proxy.readBuffer = ""
  return true
end

function Proxy.registerIntentHandler(action, handler)
  if type(action) ~= "string" or action == "" then
    return nil, "action must be a non-empty string"
  end
  if type(handler) ~= "function" then
    return nil, "handler must be a function"
  end

  Proxy.intentHandlers[action] = handler
  return true
end

function Proxy.unregisterIntentHandler(action)
  Proxy.intentHandlers[action] = nil
end

function Proxy.registerGameCommand(action, commandBuilder)
  if type(commandBuilder) ~= "function" then
    return nil, "commandBuilder must be a function"
  end

  return Proxy.registerIntentHandler(action, function(payload, message)
    local command, reason = commandBuilder(payload, message)
    if type(command) ~= "string" or command == "" then
      return false, reason or "command builder declined the intent"
    end

    -- The command can only originate from locally trusted Lua code. The bridge
    -- sends typed data and is never allowed to supply this string directly.
    send(command)
    return true
  end)
end

function Proxy.publishSnapshot(observer, entities, metadata)
  if type(observer) ~= "table" then
    return nil, "observer must be a table"
  end
  if type(entities) ~= "table" then
    return nil, "entities must be an array table"
  end

  Proxy.sequence = Proxy.sequence + 1
  return Proxy.sendMessage({
    type = "system_snapshot",
    sequence = Proxy.sequence,
    observedAt = os.time(),
    observer = observer,
    entities = entities,
    metadata = metadata or {},
  })
end

function Proxy.publishSpaceState(inSpace, reason)
  if type(inSpace) ~= "boolean" then
    return nil, "inSpace must be a boolean"
  end
  return Proxy.sendMessage({
    type = "space_state",
    observedAt = os.time(),
    inSpace = inSpace,
    reason = reason,
  })
end

function Proxy.parseGameOutput(command, output)
  if not Proxy.parsers then
    return nil, "LotJ parsers could not be loaded: " .. tostring(parsersOrError)
  end
  return Proxy.parsers.parse(command, output)
end

-- Safe built-in used by the mock bridge to prove the reverse path. It performs
-- no game action.
Proxy.registerIntentHandler("prototype_ping", function(payload)
  diagnostic("info", "received prototype ping: " .. tostring(payload.message or "pong"))
  return true
end)

lotjHolocron3D = Proxy
return Proxy
