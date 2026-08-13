lotjHolocron3DPackage = lotjHolocron3DPackage or {}

local Package = lotjHolocron3DPackage
Package.VERSION = "0.1.0"
Package.root = getMudletHomeDir() .. "/Holocron3D"

local function fileExists(path)
  local file = io.open(path, "rb")
  if not file then return false end
  file:close()
  return true
end

local function say(color, message)
  cecho(string.format("\n<%s>[Holocron3D] %s<reset>\n", color, tostring(message)))
end

local function installedPaths()
  local localAppData = (os.getenv("LOCALAPPDATA") or ""):gsub("\\", "/")
  local root = localAppData .. "/Holocron3D"
  return root .. "/bin/holocron-relay.exe", root .. "/Update.exe"
end

function Package.stop(quiet)
  if lotjHolocron3D and type(lotjHolocron3D.stop) == "function" then
    pcall(lotjHolocron3D.stop)
  end
  if not quiet then say("yellow", "telemetry stopped") end
  return true
end

function Package.start()
  Package.stop(true)
  package.path = package.path .. ";" .. Package.root .. "/?.lua"
  package.loaded["lotj_holocron_proxy"] = nil
  package.loaded["lotj_holocron_parsers"] = nil
  package.loaded["lotj_holocron_scraper"] = nil

  local relay, updater = installedPaths()
  if not fileExists(relay) or not fileExists(updater) then
    say("red", "the Windows desktop app is not installed or has not been opened yet")
    say("yellow", "install Holocron3D, open it once, then enter: h3d start")
    return nil, "desktop app unavailable"
  end

  local loaded, proxyOrError = pcall(require, "lotj_holocron_proxy")
  if not loaded then
    say("red", "could not load the telemetry proxy: " .. tostring(proxyOrError))
    return nil, proxyOrError
  end
  lotjHolocron3D = proxyOrError

  lotjHolocron3D.onDiagnostic = function(level, message)
    local color = level == "error" and "red" or level == "warn" and "yellow" or "cyan"
    say(color, message)
  end
  lotjHolocron3D.onReady = function()
    say("green", "Mudlet is connected to the desktop renderer")
  end

  local scraperLoaded, scraperOrError = pcall(require, "lotj_holocron_scraper")
  if not scraperLoaded then
    say("red", "could not load live scraping: " .. tostring(scraperOrError))
    return nil, scraperOrError
  end
  local scraperReady, scraperError = scraperOrError.setup(lotjHolocron3D)
  if not scraperReady then
    say("red", "could not start live scraping: " .. tostring(scraperError))
    return nil, scraperError
  end

  local started, startError = lotjHolocron3D.start(relay, {
    "--app", updater,
    "--squirrel-exe", "Holocron3D.exe",
  })
  if not started then
    scraperOrError.teardown()
    say("red", "could not start the desktop bridge: " .. tostring(startError))
    return nil, startError
  end
  say("yellow", "desktop bridge started; waiting for connection")
  return true
end

function Package.status()
  local connected = lotjHolocron3D and lotjHolocron3D.isRunning
    and lotjHolocron3D.isRunning()
  local polling = lotjHolocron3D and lotjHolocron3D.scraper
    and lotjHolocron3D.scraper.getPollingState
    and lotjHolocron3D.scraper.getPollingState()
  say(connected and "green" or "yellow", connected and "bridge connected" or "bridge stopped")
  if polling then
    local pollingMessage = not polling.enabled and "telemetry polling disabled"
      or polling.active and "telemetry polling active"
      or "telemetry polling armed; waiting for confirmed space activity"
    say("cyan", pollingMessage)
  end
end

function Package.command(action)
  action = (action or "status"):lower()
  if action == "start" then return Package.start() end
  if action == "stop" then return Package.stop() end
  if action == "status" then return Package.status() end
  if action == "snapshot" then
    if lotjHolocron3D and lotjHolocron3D.scraper then
      display(lotjHolocron3D.scraper.getSnapshot())
    else
      say("yellow", "telemetry has not started")
    end
    return
  end
  say("cyan", "commands: h3d start | stop | status | snapshot | help")
end

tempTimer(0, function() Package.start() end)
