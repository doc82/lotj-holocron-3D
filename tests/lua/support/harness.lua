local Harness = { tests = {}, suite = {}, beforeEach = nil, afterEach = nil }

local function fullName(name)
  local parts = {}
  for _, value in ipairs(Harness.suite) do
    table.insert(parts, value)
  end
  table.insert(parts, name)
  return table.concat(parts, " / ")
end

function Harness.describe(name, callback)
  table.insert(Harness.suite, name)
  callback()
  table.remove(Harness.suite)
end

function Harness.it(name, callback)
  table.insert(Harness.tests, {
    name = fullName(name),
    callback = callback,
    beforeEach = Harness.beforeEach,
    afterEach = Harness.afterEach,
  })
end

function Harness.before_each(callback)
  Harness.beforeEach = callback
end
function Harness.after_each(callback)
  Harness.afterEach = callback
end

function Harness.equal(actual, expected, message)
  assert(
    actual == expected,
    string.format(
      "%s: expected %s, got %s",
      message or "values differ",
      tostring(expected),
      tostring(actual)
    )
  )
end

function Harness.matches(value, pattern, message)
  assert(
    tostring(value):match(pattern),
    message or string.format("expected %s to match %s", tostring(value), tostring(pattern))
  )
end

function Harness.run(filter)
  local passed, failed, selected = 0, 0, 0
  filter = filter and filter:lower() or nil
  for _, test in ipairs(Harness.tests) do
    if not filter or test.name:lower():find(filter, 1, true) then
      selected = selected + 1
      local setupOk, setupFailure = true, nil
      if test.beforeEach then
        setupOk, setupFailure = xpcall(test.beforeEach, debug.traceback)
      end
      local testOk, testFailure = false, setupFailure
      if setupOk then
        testOk, testFailure = xpcall(test.callback, debug.traceback)
      end
      local teardownOk, teardownFailure = true, nil
      if test.afterEach then
        teardownOk, teardownFailure = xpcall(test.afterEach, debug.traceback)
      end
      local ok = setupOk and testOk and teardownOk
      local failure = setupFailure or testFailure or teardownFailure
      if ok then
        passed = passed + 1
        print("PASS " .. test.name)
      else
        failed = failed + 1
        io.stderr:write("FAIL " .. test.name .. "\n" .. tostring(failure) .. "\n")
      end
    end
  end
  if selected == 0 then
    io.stderr:write("No Lua tests matched filter: " .. tostring(filter) .. "\n")
    return false
  end
  print(string.format("Lua tests: %d passed, %d failed, %d selected", passed, failed, selected))
  return failed == 0
end

return Harness
