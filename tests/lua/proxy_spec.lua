local h = require("harness")
local describe, it, equal = h.describe, h.it, h.equal

describe("Mudlet process proxy", function()
  it("reports legacy relay stderr as a transport warning instead of invalid JSON", function()
    local originalYajl = _G.yajl
    local originalProxy = _G.lotjHolocron3D
    local decoded = 0
    _G.yajl = {
      to_value = function()
        decoded = decoded + 1
        error("relay stderr must not reach the JSON decoder")
      end,
    }
    package.loaded.lotj_holocron_proxy = nil
    local proxy = require("lotj_holocron_proxy")
    local diagnostic
    local disconnected
    proxy.onDiagnostic = function(level, message)
      diagnostic = { level = level, message = message }
    end
    proxy.onDisconnect = function(reason)
      disconnected = reason
    end
    proxy.ready = true

    proxy.handleProcessOutput("    Holocron3D relay: write tcp 127.0.0.1: connection reset\n")

    equal(decoded, 0)
    equal(diagnostic.level, "warn")
    assert(diagnostic.message:find("desktop bridge disconnected", 1, true))
    equal(disconnected, "write tcp 127.0.0.1: connection reset")
    equal(proxy.ready, false)

    package.loaded.lotj_holocron_proxy = nil
    _G.yajl = originalYajl
    _G.lotjHolocron3D = originalProxy
  end)

  it("tracks authenticated readiness across structured disconnects", function()
    local originalProxy = _G.lotjHolocron3D
    package.loaded.lotj_holocron_proxy = nil
    local proxy = require("lotj_holocron_proxy")
    proxy.process = {
      isRunning = function()
        return true
      end,
    }
    local disconnected
    proxy.onDisconnect = function(reason)
      disconnected = reason
    end

    proxy.handleMessage({ v = 1, type = "ready", bridge = "desktop" })
    assert(proxy.isReady())
    proxy.handleMessage({
      v = 1,
      type = "bridge_diagnostic",
      level = "warn",
      message = "desktop bridge disconnected; reconnecting",
    })

    equal(proxy.isReady(), false)
    equal(disconnected, "desktop bridge disconnected; reconnecting")
    proxy.process = nil
    package.loaded.lotj_holocron_proxy = nil
    _G.lotjHolocron3D = originalProxy
  end)
end)
