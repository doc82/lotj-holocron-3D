lotjHolocron3DPackage = lotjHolocron3DPackage or {}

local Package = lotjHolocron3DPackage
Package.VERSION = "0.1.0"
Package.root = getMudletHomeDir() .. "/Holocron3D"
Package.devConfigPath = getMudletHomeDir() .. "/holocron3d-dev-app-path.txt"

local function trim(value)
  return (tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

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

local function normalizePath(path)
  path = trim(path):gsub('^"(.*)"$', "%1"):gsub("^'(.*)'$", "%1")
  return path:gsub("\\", "/"):gsub("/+$", "")
end

local function readDevExecutable()
  local file = io.open(Package.devConfigPath, "rb")
  if not file then return nil end
  local path = normalizePath(file:read("*a"))
  file:close()
  if path == "" then return nil end
  return path
end

local function resolveDevExecutable(path)
  path = normalizePath(path)
  if path == "" then return nil end
  local candidates = {path}
  if not path:lower():match("%.exe$") then
    table.insert(candidates, path .. "/Holocron3D.exe")
    table.insert(candidates,
      path .. "/LotJ Holocron 3D-win32-x64/Holocron3D.exe")
    table.insert(candidates,
      path .. "/out/LotJ Holocron 3D-win32-x64/Holocron3D.exe")
  end
  for _, candidate in ipairs(candidates) do
    if fileExists(candidate) then return candidate end
  end
  return nil
end

local function writeDevExecutable(path)
  local file, openError = io.open(Package.devConfigPath, "wb")
  if not file then return nil, openError end
  file:write(path, "\n")
  file:close()
  return true
end

function Package.setDevelopmentMode(argument)
  local mode, path = trim(argument):match("^(%S+)%s*(.-)$")
  mode = mode and mode:lower() or "status"
  if mode == "off" then
    os.remove(Package.devConfigPath)
    say("green", "development mode disabled; the installed desktop app will be used")
    return true
  end
  if mode == "status" then
    local configured = readDevExecutable()
    say("cyan", configured and ("development mode: " .. configured)
      or "development mode disabled")
    return true
  end
  if mode ~= "on" then
    say("yellow", "usage: h3d dev on <repository, out directory, or executable path> | h3d dev off")
    return nil, "invalid development-mode command"
  end

  local executable = resolveDevExecutable(path)
  if not executable then
    say("red", "could not find the local Holocron3D.exe beneath that path")
    say("yellow", "build it with pnpm package, then pass the repository path")
    return nil, "development executable unavailable"
  end
  local saved, saveError = writeDevExecutable(executable)
  if not saved then
    say("red", "could not save development mode: " .. tostring(saveError))
    return nil, saveError
  end
  say("green", "development mode enabled: " .. executable)
  say("yellow", "close any installed Holocron3D window, then enter: h3d start")
  return true
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
  local devExecutable = readDevExecutable()
  if not fileExists(relay) then
    say("red", "the Windows desktop app is not installed or has not been opened yet")
    say("yellow", "install Holocron3D, open it once, then enter: h3d start")
    return nil, "desktop app unavailable"
  end
  if devExecutable and not fileExists(devExecutable) then
    say("red", "development mode points to a missing executable: " .. devExecutable)
    say("yellow", "rebuild it, choose a new path, or enter: h3d dev off")
    return nil, "development executable unavailable"
  end
  if not devExecutable and not fileExists(updater) then
    say("red", "the installed Windows desktop app launcher is unavailable")
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

  local relayArguments = devExecutable
    and {"--app", devExecutable}
    or {"--app", updater, "--squirrel-exe", "Holocron3D.exe"}
  local started, startError = lotjHolocron3D.start(relay, relayArguments)
  if not started then
    scraperOrError.teardown()
    say("red", "could not start the desktop bridge: " .. tostring(startError))
    return nil, startError
  end
  say("yellow", (devExecutable and "development" or "installed")
    .. " desktop bridge started; waiting for connection")
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
  local devExecutable = readDevExecutable()
  say("cyan", devExecutable and ("development app: " .. devExecutable)
    or "desktop mode: installed app")
end

function Package.command(action, argument)
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
  if action == "dev" then return Package.setDevelopmentMode(argument) end
  say("cyan", "commands: h3d start | stop | status | snapshot | dev | help")
  say("cyan", "development: h3d dev on <repository path> | h3d dev off")
end

tempTimer(0, function() Package.start() end)
