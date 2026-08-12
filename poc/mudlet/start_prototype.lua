-- Beginner-friendly launcher for the Mudlet proxy prototype.
-- Run with:
-- lua dofile([[C:/path/to/lotj-holocron-3D/poc/mudlet/start_prototype.lua]])

local function normalizePath(path)
  return path and path:gsub("\\", "/") or nil
end

local function fileExists(path)
  if not path or path == "" then
    return false
  end

  local file = io.open(path, "rb")
  if file then
    file:close()
    return true
  end
  return false
end

local source = package.loaded.debug.getinfo(1, "S").source
if source:sub(1, 1) ~= "@" then
  error("Could not determine the location of start_prototype.lua")
end

local launcherPath = normalizePath(source:sub(2))
local repoRoot = launcherPath:match("^(.*)/poc/mudlet/start_prototype%.lua$")
if not repoRoot then
  error("start_prototype.lua must remain inside the repository's poc/mudlet folder")
end

local nodeCandidates = {
  normalizePath((os.getenv("ProgramFiles") or "") .. "/nodejs/node.exe"),
  normalizePath((os.getenv("USERPROFILE") or "")
    .. "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"),
}

local nodeProgram = "node"
for _, candidate in ipairs(nodeCandidates) do
  if fileExists(candidate) then
    nodeProgram = candidate
    break
  end
end

local bridgeProgram = nodeProgram
local bridgeArguments = {repoRoot .. "/poc/tools/network-bridge.mjs"}
local bridgeDescription = "Node development bridge"
local relayProgram = repoRoot .. "/relay/bin/holocron-relay.exe"
local electronProgram = repoRoot .. "/node_modules/electron/dist/electron.exe"
local localAppData = normalizePath(os.getenv("LOCALAPPDATA") or "")
local installedRoot = localAppData .. "/Holocron3D"
local installedRelay = installedRoot .. "/bin/holocron-relay.exe"
local installedUpdater = installedRoot .. "/Update.exe"
if fileExists(relayProgram) and fileExists(electronProgram) then
  bridgeProgram = relayProgram
  bridgeArguments = {
    "--app", electronProgram,
    "--app-dir", repoRoot,
  }
  bridgeDescription = "Electron development host"
elseif fileExists(installedRelay) and fileExists(installedUpdater) then
  bridgeProgram = installedRelay
  bridgeArguments = {
    "--app", installedUpdater,
    "--squirrel-exe", "Holocron3D.exe",
  }
  bridgeDescription = "installed Electron app"
end

package.path = package.path .. ";" .. repoRoot .. "/mudlet/?.lua"

if lotjHolocron3D and lotjHolocron3D.stop then
  lotjHolocron3D.stop()
end
package.loaded["lotj_holocron_proxy"] = nil
package.loaded["lotj_holocron_parsers"] = nil
package.loaded["lotj_holocron_scraper"] = nil

local loaded, proxyOrError = pcall(require, "lotj_holocron_proxy")
if not loaded then
  cecho("<red>Holocron3D could not load its Mudlet proxy.\n")
  cecho("<red>Reason: " .. tostring(proxyOrError) .. "\n")
  return
end

lotjHolocron3D = proxyOrError

lotjHolocron3D.onDiagnostic = function(level, message)
  local color = level == "error" and "<red>"
    or level == "warn" and "<yellow>"
    or "<cyan>"
  cecho(color .. "[Holocron3D] " .. tostring(message) .. "\n")
end

lotjHolocron3D.onReady = function()
  cecho("<green>[Holocron3D] Mudlet and the bridge are connected.\n")
  cecho("<green>[Holocron3D] WebSocket endpoint: "
    .. tostring(lotjHolocron3D.websocketUrl or "unavailable") .. "\n")
  if lotjHolocron3D.renderer == "electron" then
    cecho("<green>[Holocron3D] 3D renderer: Electron desktop window\n")
  else
    cecho("<green>[Holocron3D] 3D renderer: "
      .. tostring(lotjHolocron3D.rendererUrl or "unavailable") .. "\n")
  end
  cecho("<green>[Holocron3D] Telemetry polling is automatic; commands remain available for manual refreshes.\n")
end

local scraperLoaded, scraperOrError = pcall(require, "lotj_holocron_scraper")
if not scraperLoaded then
  cecho("<red>[Holocron3D] Live scraper could not load: " .. tostring(scraperOrError) .. "\n")
  return
end

local scraperReady, scraperError = scraperOrError.setup(lotjHolocron3D)
if not scraperReady then
  cecho("<red>[Holocron3D] Live scraper could not start: " .. tostring(scraperError) .. "\n")
  return
end

local started, startError = lotjHolocron3D.start(bridgeProgram, bridgeArguments)

if started then
  cecho("<yellow>[Holocron3D] " .. bridgeDescription
    .. " started; waiting for its reply...\n")
else
  scraperOrError.teardown()
  cecho("<red>[Holocron3D] Bridge could not start.\n")
  cecho("<red>Reason: " .. tostring(startError) .. "\n")
  cecho("<yellow>Bridge program tried: " .. tostring(bridgeProgram) .. "\n")
end
