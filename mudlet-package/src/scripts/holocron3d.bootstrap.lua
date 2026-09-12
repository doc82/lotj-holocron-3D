lotjHolocron3DPackage = lotjHolocron3DPackage or {}

local Package = lotjHolocron3DPackage
Package.VERSION = "0.1.14"
Package.root = getMudletHomeDir() .. "/Holocron3D"
Package.devConfigPath = getMudletHomeDir() .. "/holocron3d-dev-app-path.txt"
Package.settingsPath = getMudletHomeDir() .. "/holocron3d-settings.txt"
Package.infoCachePath = getMudletHomeDir() .. "/holocron3d-ship-info-cache.json"
Package.settings = { confirmations = true, debug = false }

local function trim(value)
  return (tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function fileExists(path)
  local file = io.open(path, "rb")
  if not file then
    return false
  end
  file:close()
  return true
end

local function say(color, message)
  cecho(string.format("\n<%s>[Holocron3D] %s<reset>\n", color, tostring(message)))
end

local function platformName()
  local reported = type(getOS) == "function" and tostring(getOS()):lower() or ""
  if reported:find("mac", 1, true) or reported:find("osx", 1, true) then
    return "macos"
  end
  if reported:find("win", 1, true) then
    return "windows"
  end
  if reported:find("linux", 1, true) then
    return "linux"
  end
  if jit then
    local jitOS = tostring(jit.os):lower()
    if jitOS == "osx" then
      return "macos"
    end
    if jitOS == "linux" then
      return "linux"
    end
  end
  return "windows"
end

local function loadSettings()
  local file = io.open(Package.settingsPath, "rb")
  if not file then
    return
  end
  for line in file:lines() do
    local key, value = line:match("^(%w+)%s*=%s*(%w+)$")
    if Package.settings[key] ~= nil then
      Package.settings[key] = value == "true"
    end
  end
  file:close()
end

local function saveSettings()
  local file, openError = io.open(Package.settingsPath, "wb")
  if not file then
    return nil, openError
  end
  file:write("confirmations=", tostring(Package.settings.confirmations), "\n")
  file:write("debug=", tostring(Package.settings.debug), "\n")
  file:close()
  return true
end

local function confirmation(color, message)
  if Package.settings.confirmations then
    say(color, message)
  end
end

local function setBooleanSetting(name, argument)
  local value = trim(argument):lower()
  if value == "" or value == "status" then
    say("cyan", name .. " " .. (Package.settings[name] and "on" or "off"))
    return true
  end
  if value ~= "on" and value ~= "off" then
    say("yellow", "usage: h3d " .. name .. " on | off")
    return nil, "invalid setting"
  end
  Package.settings[name] = value == "on"
  local saved, saveError = saveSettings()
  if not saved then
    say("red", "could not save settings: " .. tostring(saveError))
    return nil, saveError
  end
  say("green", name .. " " .. value)
  return true
end

loadSettings()

local function installedPaths()
  local platform = platformName()
  if platform == "macos" then
    local home = (os.getenv("HOME") or ""):gsub("\\", "/")
    local root = home .. "/Library/Application Support/Holocron3D"
    local applications = {
      "/Applications/LotJ Holocron 3D.app/Contents/MacOS/Holocron3D",
      home .. "/Applications/LotJ Holocron 3D.app/Contents/MacOS/Holocron3D",
    }
    local launcher = applications[1]
    for _, candidate in ipairs(applications) do
      if fileExists(candidate) then
        launcher = candidate
        break
      end
    end
    return root .. "/bin/holocron-relay", launcher, root .. "/bridge-token", false
  end
  if platform == "linux" then
    local home = (os.getenv("HOME") or ""):gsub("\\", "/")
    local dataHome = (os.getenv("XDG_DATA_HOME") or ""):gsub("\\", "/")
    if dataHome == "" then
      dataHome = home .. "/.local/share"
    end
    local root = dataHome .. "/Holocron3D"
    local launcherFile = io.open(root .. "/desktop-launcher", "rb")
    local recordedLauncher = ""
    if launcherFile then
      recordedLauncher = trim(launcherFile:read("*l")):gsub("\\", "/")
      launcherFile:close()
    end
    local applications = {
      recordedLauncher,
      home .. "/.local/opt/Holocron3D/Holocron3D",
      home .. "/Applications/Holocron3D/Holocron3D",
      "/opt/Holocron3D/Holocron3D",
    }
    local launcher = applications[2]
    for _, candidate in ipairs(applications) do
      if candidate ~= "" and fileExists(candidate) then
        launcher = candidate
        break
      end
    end
    return root .. "/bin/holocron-relay", launcher, root .. "/bridge-token", false
  end
  local localAppData = (os.getenv("LOCALAPPDATA") or ""):gsub("\\", "/")
  local root = localAppData .. "/Holocron3D"
  return root .. "/bin/holocron-relay.exe", root .. "/Update.exe", root .. "/bridge-token", true
end

local function normalizePath(path)
  path = trim(path):gsub('^"(.*)"$', "%1"):gsub("^'(.*)'$", "%1")
  return path:gsub("\\", "/"):gsub("/+$", "")
end

local function readDevExecutable()
  local file = io.open(Package.devConfigPath, "rb")
  if not file then
    return nil
  end
  local path = normalizePath(file:read("*a"))
  file:close()
  if path == "" then
    return nil
  end
  return path
end

local function resolveDevExecutable(path)
  path = normalizePath(path)
  if path == "" then
    return nil
  end
  local candidates = { path }
  if not path:lower():match("%.exe$") then
    table.insert(candidates, path .. "/Holocron3D.exe")
    table.insert(candidates, path .. "/LotJ Holocron 3D-win32-x64/Holocron3D.exe")
    table.insert(candidates, path .. "/out/LotJ Holocron 3D-win32-x64/Holocron3D.exe")
    table.insert(candidates, path .. "/Holocron3D")
    table.insert(candidates, path .. "/LotJ Holocron 3D-linux-x64/Holocron3D")
    table.insert(candidates, path .. "/out/LotJ Holocron 3D-linux-x64/Holocron3D")
    table.insert(candidates, path .. "/LotJ Holocron 3D.app/Contents/MacOS/Holocron3D")
    table.insert(
      candidates,
      path .. "/out/LotJ Holocron 3D-darwin-arm64/LotJ Holocron 3D.app/Contents/MacOS/Holocron3D"
    )
    table.insert(
      candidates,
      path .. "/out/LotJ Holocron 3D-darwin-x64/LotJ Holocron 3D.app/Contents/MacOS/Holocron3D"
    )
  end
  for _, candidate in ipairs(candidates) do
    if fileExists(candidate) then
      return candidate
    end
  end
  return nil
end

local function resolveDevRelay(executable)
  local directory = normalizePath(executable):match("^(.*)/[^/]+$")
  if not directory then
    return nil
  end
  local candidates = {
    directory .. "/resources/holocron-relay.exe",
    directory .. "/resources/holocron-relay",
    directory .. "/../Resources/holocron-relay",
  }
  for _, candidate in ipairs(candidates) do
    if fileExists(candidate) then
      return candidate
    end
  end
  return nil
end

local function resolveRuntime(requireLauncher)
  local relay, launcher, token, squirrel = installedPaths()
  local devExecutable = readDevExecutable()
  if devExecutable and not fileExists(devExecutable) then
    say("red", "development mode points to a missing executable: " .. devExecutable)
    say("yellow", "rebuild it, choose a new path, or enter: h3d dev off")
    return nil, "development executable unavailable"
  end
  if devExecutable then
    local devRelay = resolveDevRelay(devExecutable)
    if not devRelay then
      say("red", "development mode could not find the relay packaged beside: " .. devExecutable)
      say("yellow", "rebuild it with pnpm package")
      return nil, "development relay unavailable"
    end
    relay = devRelay
    launcher = devExecutable
    squirrel = false
  elseif not fileExists(relay) then
    say("red", "the telemetry relay is unavailable")
    say("yellow", "install Holocron3D and open it once, then try again")
    return nil, "desktop relay unavailable"
  end
  if requireLauncher and not fileExists(launcher) then
    say("red", "the desktop app launcher is unavailable")
    return nil, "desktop app unavailable"
  end
  return {
    relay = relay,
    launcher = launcher,
    token = token,
    squirrel = squirrel,
    devExecutable = devExecutable,
  }
end

local function writeDevExecutable(path)
  local file, openError = io.open(Package.devConfigPath, "wb")
  if not file then
    return nil, openError
  end
  file:write(path, "\n")
  file:close()
  return true
end

function Package.setDevelopmentMode(argument)
  local mode, path = trim(argument):match("^(%S+)%s*(.-)$")
  mode = mode and mode:lower() or "status"
  if mode == "off" then
    os.remove(Package.devConfigPath)
    confirmation("green", "development mode disabled; the installed desktop app will be used")
    return true
  end
  if mode == "status" then
    local configured = readDevExecutable()
    say("cyan", configured and ("development mode: " .. configured) or "development mode disabled")
    return true
  end
  if mode ~= "on" then
    say("yellow", "usage: h3d dev on <repository, out directory, or executable path> | h3d dev off")
    return nil, "invalid development-mode command"
  end

  local executable = resolveDevExecutable(path)
  if not executable then
    say("red", "could not find a local Holocron3D desktop executable beneath that path")
    say("yellow", "build it with pnpm package, then pass the repository path")
    return nil, "development executable unavailable"
  end
  local saved, saveError = writeDevExecutable(executable)
  if not saved then
    say("red", "could not save development mode: " .. tostring(saveError))
    return nil, saveError
  end
  confirmation("green", "development mode enabled: " .. executable)
  confirmation("yellow", "close any installed Holocron3D window, then enter: h3d launch")
  return true
end

function Package.launch()
  local runtime, runtimeError = resolveRuntime(true)
  if not runtime then
    return nil, runtimeError
  end
  if type(spawn) ~= "function" then
    say("red", "Mudlet spawn() is unavailable; version 4.11 or newer is required")
    return nil, "Mudlet spawn is unavailable"
  end

  local arguments = { "--launch-only", "--app", runtime.launcher }
  if runtime.squirrel then
    table.insert(arguments, "--squirrel-exe")
    table.insert(arguments, "Holocron3D.exe")
  end
  local ok, processOrError = pcall(spawn, function(chunk)
    local output = trim(chunk)
    if output ~= "" then
      say("red", "desktop launch failed: " .. output)
    end
  end, runtime.relay, unpack(arguments))
  if not ok or type(processOrError) ~= "table" then
    local launchError = ok and "spawn() did not return a process handle" or tostring(processOrError)
    say("red", "could not launch the desktop app: " .. launchError)
    return nil, launchError
  end
  Package.launchProcess = processOrError
  confirmation("green", "desktop launch requested; telemetry lifecycle unchanged")
  return true
end

function Package.stop(quiet)
  if lotjHolocron3D and type(lotjHolocron3D.stop) == "function" then
    if lotjHolocron3D.DESKTOP_LIFECYCLE_DECOUPLED then
      pcall(lotjHolocron3D.stop)
    else
      -- Packages loaded before lifecycle decoupling sent a desktop shutdown
      -- from stop(). Close their relay directly during an in-place upgrade.
      if lotjHolocron3D.scraper and type(lotjHolocron3D.scraper.teardown) == "function" then
        pcall(lotjHolocron3D.scraper.teardown)
      end
      if lotjHolocron3D.process and type(lotjHolocron3D.process.close) == "function" then
        pcall(lotjHolocron3D.process.close)
      end
      lotjHolocron3D.process = nil
      lotjHolocron3D.ready = false
    end
  end
  if not quiet then
    confirmation("yellow", "telemetry stopped; desktop app left running")
  end
  return true
end

function Package.start()
  if lotjHolocron3D and type(lotjHolocron3D.isRunning) == "function" then
    if lotjHolocron3D.isRunning() then
      confirmation(
        lotjHolocron3D.isReady and lotjHolocron3D.isReady() and "green" or "yellow",
        lotjHolocron3D.isReady and lotjHolocron3D.isReady() and "telemetry is already connected"
          or "telemetry is already started; waiting for the desktop app"
      )
      return true
    end
  end
  package.path = package.path .. ";" .. Package.root .. "/?.lua"
  package.loaded["lotj_holocron_proxy"] = nil
  package.loaded["lotj_holocron_parsers"] = nil
  package.loaded["lotj_holocron_scraper"] = nil
  package.loaded["lotj_holocron_navigation"] = nil
  package.loaded["lotj_holocron_topology"] = nil
  package.loaded["lotj_holocron_topology_data"] = nil

  local runtime, runtimeError = resolveRuntime(false)
  if not runtime then
    return nil, runtimeError
  end

  local loaded, proxyOrError = pcall(require, "lotj_holocron_proxy")
  if not loaded then
    say("red", "could not load the telemetry proxy: " .. tostring(proxyOrError))
    return nil, proxyOrError
  end
  lotjHolocron3D = proxyOrError

  lotjHolocron3D.onDiagnostic = function(level, message)
    if level ~= "error" and level ~= "warn" and not Package.settings.debug then
      return
    end
    local color = level == "error" and "red" or level == "warn" and "yellow" or "cyan"
    say(color, message)
  end
  local scraperLoaded, scraperOrError = pcall(require, "lotj_holocron_scraper")
  if not scraperLoaded then
    say("red", "could not load live scraping: " .. tostring(scraperOrError))
    return nil, scraperOrError
  end
  local scraper = scraperOrError
  local resumePollingAfterReconnect = false
  lotjHolocron3D.onReady = function()
    confirmation("green", "Mudlet is connected to the desktop renderer")
    local polling = scraper.getPollingState()
    if resumePollingAfterReconnect then
      resumePollingAfterReconnect = false
      scraper.setPollingPaused(false, "bridge reconnected")
    elseif not polling.enabled and not polling.resumeWhenInSpace then
      local pollingReady, pollingError = scraper.startStartupPolling()
      if not pollingReady then
        say("red", "telemetry polling could not start: " .. tostring(pollingError))
      end
    end
  end
  lotjHolocron3D.onDisconnect = function()
    local polling = scraper.getPollingState()
    resumePollingAfterReconnect = (polling.enabled or polling.resumeWhenInSpace)
      and not polling.paused
    if resumePollingAfterReconnect then
      scraper.setPollingPaused(true, "bridge disconnected")
      confirmation("yellow", "desktop connection lost; telemetry polling suspended")
    end
  end

  local scraperReady, scraperError = scraper.setup(lotjHolocron3D, {
    polling = false,
    infoCache = { path = Package.infoCachePath },
  })
  if not scraperReady then
    say("red", "could not start live scraping: " .. tostring(scraperError))
    return nil, scraperError
  end

  local relayArguments = { "--token-file", runtime.token }
  local started, startError = lotjHolocron3D.start(runtime.relay, relayArguments)
  if not started then
    scraperOrError.teardown()
    say("red", "could not start the desktop bridge: " .. tostring(startError))
    return nil, startError
  end
  confirmation(
    "yellow",
    (runtime.devExecutable and "development" or "installed")
      .. " telemetry started; waiting for the desktop app (h3d launch)"
  )
  return true
end

function Package.reconnect()
  if not lotjHolocron3D or type(lotjHolocron3D.isRunning) ~= "function" then
    say("yellow", "telemetry is stopped; enter h3d start first")
    return nil, "telemetry is not running"
  end
  if not lotjHolocron3D.isRunning() then
    say("yellow", "telemetry is stopped; enter h3d start first")
    return nil, "telemetry is not running"
  end
  if not lotjHolocron3D.isReady or not lotjHolocron3D.isReady() then
    confirmation("yellow", "desktop is unavailable; telemetry is already waiting to reconnect")
    return true
  end
  local requested, reconnectError = lotjHolocron3D.reconnect()
  if not requested then
    say("red", "could not reconnect telemetry: " .. tostring(reconnectError))
    return nil, reconnectError
  end
  confirmation("yellow", "desktop reconnect requested")
  return true
end

function Package.setPollingPaused(paused)
  local scraper = lotjHolocron3D and lotjHolocron3D.scraper
  if not scraper or type(scraper.setPollingPaused) ~= "function" then
    say("yellow", "telemetry must be running before polling can be paused or resumed")
    return nil, "telemetry is not running"
  end
  local changed, changeError = scraper.setPollingPaused(paused == true, "mudlet")
  if not changed then
    say("red", "could not change polling state: " .. tostring(changeError))
    return nil, changeError
  end
  confirmation(
    paused and "yellow" or "green",
    paused and "telemetry polling paused; manual commands have a clear output window"
      or "telemetry polling resumed"
  )
  return true
end

function Package.status()
  local running = lotjHolocron3D and lotjHolocron3D.isRunning and lotjHolocron3D.isRunning()
  local connected = lotjHolocron3D and lotjHolocron3D.isReady and lotjHolocron3D.isReady()
  local polling = lotjHolocron3D
    and lotjHolocron3D.scraper
    and lotjHolocron3D.scraper.getPollingState
    and lotjHolocron3D.scraper.getPollingState()
  say(
    connected and "green" or "yellow",
    connected and "bridge connected"
      or running and "bridge started; waiting for desktop connection"
      or "bridge stopped"
  )
  if polling then
    local pollingMessage = polling.paused and "telemetry polling PAUSED"
      or not polling.enabled and "telemetry polling disabled"
      or polling.active and "telemetry polling active"
      or "telemetry polling armed; waiting for confirmed space activity"
    say(polling.paused and "yellow" or "cyan", pollingMessage)
  end
  local devExecutable = readDevExecutable()
  say(
    "cyan",
    devExecutable and ("development app: " .. devExecutable) or "desktop mode: installed app"
  )
  say(
    "cyan",
    "confirmations "
      .. (Package.settings.confirmations and "on" or "off")
      .. " // debug "
      .. (Package.settings.debug and "on" or "off")
  )
end

local function profileRate(value, elapsed)
  if not elapsed or elapsed <= 0 then
    return 0
  end
  return (tonumber(value) or 0) / elapsed
end

local function profileTimingLine(name, timing)
  if type(timing) ~= "table" or (timing.count or 0) == 0 then
    return nil
  end
  local totalMs = (timing.totalSeconds or 0) * 1000
  return string.format(
    "%s: %.2f ms total // %.3f ms avg // %.3f ms max // %d calls",
    name,
    totalMs,
    totalMs / timing.count,
    (timing.maxSeconds or 0) * 1000,
    timing.count
  )
end

local function showProfileReport(report)
  local elapsed = math.max(0.001, tonumber(report.elapsedSeconds) or 0)
  local counts = report.counts or {}
  say(
    "cyan",
    string.format(
      "profiler %s // %.1fs elapsed",
      report.enabled and "running" or "stopped",
      elapsed
    )
  )
  say(
    "cyan",
    string.format(
      "GMCP Ship.Info: %d (%.2f/s) // snapshots: %d (%.2f/s), %d failures",
      counts.shipGmcpEvents or 0,
      profileRate(counts.shipGmcpEvents, elapsed),
      counts.snapshotPublishes or 0,
      profileRate(counts.snapshotPublishes, elapsed),
      counts.snapshotFailures or 0
    )
  )
  say(
    "cyan",
    string.format(
      "captures: %d started, %d finished, %d abandoned, %d polled",
      counts.capturesStarted or 0,
      counts.capturesFinished or 0,
      counts.capturesAbandoned or 0,
      counts.polledCaptures or 0
    )
  )
  say(
    "cyan",
    string.format(
      "capture traffic: %d line checks, %d owned, %d deleted, %.1f KiB retained",
      counts.lineChecks or 0,
      counts.capturedLines or 0,
      counts.deletedLines or 0,
      (counts.capturedBytes or 0) / 1024
    )
  )
  say(
    "cyan",
    string.format(
      "automatic command duplicates suppressed: %d",
      counts.automaticCommandsThrottled or 0
    )
  )

  for _, name in ipairs({ "line", "parse", "apply", "publish", "ship_gmcp" }) do
    local timingLine = profileTimingLine(name, report.timings and report.timings[name])
    if timingLine then
      say("dim_grey", timingLine)
    end
  end
  local captureLine =
    profileTimingLine("capture response window", report.timings and report.timings.capture)
  if captureLine then
    say("dim_grey", captureLine)
  end

  local commands = {}
  for command, count in pairs(report.commands or {}) do
    table.insert(commands, { command = command, count = count })
  end
  table.sort(commands, function(left, right)
    if left.count == right.count then
      return left.command < right.command
    end
    return left.count > right.count
  end)
  if #commands > 0 then
    local parts = {}
    for index = 1, math.min(#commands, 12) do
      table.insert(parts, commands[index].command .. "=" .. commands[index].count)
    end
    say("cyan", "captures by command: " .. table.concat(parts, ", "))
  end

  local current, initial = report.objectCounts, report.objectCountsAtStart
  if type(current) == "table" then
    local parts = {}
    for _, name in ipairs({ "triggers", "patterns", "timers", "aliases", "scripts" }) do
      if current[name] ~= nil then
        local delta = type(initial) == "table"
            and initial[name] ~= nil
            and current[name] - initial[name]
          or nil
        table.insert(
          parts,
          name .. "=" .. current[name] .. (delta and string.format(" (%+d)", delta) or "")
        )
      end
    end
    if #parts > 0 then
      say("cyan", "Mudlet objects: " .. table.concat(parts, ", "))
    end
  else
    say("dim_grey", "Mudlet object counts require Mudlet 4.15 or newer")
  end
end

function Package.profile(argument)
  local action = trim(argument):lower()
  if action == "" then
    action = "report"
  end
  local scraper = lotjHolocron3D and lotjHolocron3D.scraper
  if not scraper then
    say("yellow", "telemetry must be running before profiling")
    return nil, "telemetry is not running"
  end
  if action == "start" then
    scraper.startProfiler()
    confirmation("green", "profiler started; play normally, then enter h3d profile report")
    return true
  end
  local report, reportError
  if action == "report" then
    report, reportError = scraper.getProfilerReport()
  elseif action == "stop" then
    report, reportError = scraper.stopProfiler()
  else
    say("yellow", "usage: h3d profile start | report | stop")
    return nil, "invalid profiler command"
  end
  if not report then
    say("yellow", tostring(reportError))
    return nil, reportError
  end
  showProfileReport(report)
  return report
end

function Package.command(action, argument)
  action = (action or "status"):lower()
  if action == "launch" then
    return Package.launch()
  end
  if action == "start" then
    return Package.start()
  end
  if action == "stop" then
    return Package.stop()
  end
  if action == "reconnect" then
    return Package.reconnect()
  end
  if action == "pause" then
    return Package.setPollingPaused(true)
  end
  if action == "resume" then
    return Package.setPollingPaused(false)
  end
  if action == "status" then
    return Package.status()
  end
  if action == "snapshot" then
    if lotjHolocron3D and lotjHolocron3D.scraper then
      display(lotjHolocron3D.scraper.getSnapshot())
    else
      say("yellow", "telemetry has not started")
    end
    return
  end
  if action == "dev" then
    return Package.setDevelopmentMode(argument)
  end
  if action == "profile" then
    return Package.profile(argument)
  end
  if action == "confirmations" then
    return setBooleanSetting("confirmations", argument)
  end
  if action == "debug" then
    return setBooleanSetting("debug", argument)
  end
  say(
    "cyan",
    "commands: h3d launch | start | stop | reconnect | pause | resume | status | snapshot | profile | dev | confirmations | debug | help"
  )
  say("cyan", "desktop: h3d launch")
  say("cyan", "telemetry: h3d start | stop | reconnect | status")
  say("cyan", "polling: h3d pause | resume")
  say("cyan", "profiling: h3d profile start | report | stop")
  say("cyan", "development: h3d dev on <repository path> | h3d dev off")
  say("cyan", "output: h3d confirmations on | off // h3d debug on | off")
end

tempTimer(0, function()
  Package.stop(true)
  say("yellow", "waiting for h3d start to begin Holocron3D")
end)
