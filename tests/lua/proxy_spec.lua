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
    proxy.onDiagnostic = function(level, message)
      diagnostic = { level = level, message = message }
    end

    proxy.handleProcessOutput("    Holocron3D relay: write tcp 127.0.0.1: connection reset\n")

    equal(decoded, 0)
    equal(diagnostic.level, "warn")
    assert(diagnostic.message:find("desktop bridge disconnected", 1, true))

    package.loaded.lotj_holocron_proxy = nil
    _G.yajl = originalYajl
    _G.lotjHolocron3D = originalProxy
  end)
end)
