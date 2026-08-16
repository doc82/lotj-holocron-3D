import { spawnSync } from "node:child_process";
import process from "node:process";

const testArgs = ["tests/lua/run.lua", ...process.argv.slice(2)];
const requested = process.env.LUA_BIN?.trim();
const candidates = requested
  ? [{ command: requested, prefix: [] }]
  : process.platform === "win32"
    ? [
        { command: "lua5.1", prefix: [] },
        { command: "lua", prefix: [] },
        { command: "wsl", prefix: ["lua5.1"] },
      ]
    : [
        { command: "lua5.1", prefix: [] },
        { command: "lua", prefix: [] },
      ];

for (const candidate of candidates) {
  const probe = spawnSync(
    candidate.command,
    [...candidate.prefix, "-e", "if _VERSION ~= 'Lua 5.1' then os.exit(51) end"],
    { stdio: "ignore" },
  );
  if (probe.error?.code === "ENOENT" || probe.status !== 0) continue;
  const result = spawnSync(candidate.command, [...candidate.prefix, ...testArgs], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

process.stderr.write(
  "Lua 5.1 was not found. Install lua5.1 (WSL is supported on Windows), " +
    "or set LUA_BIN to a compatible interpreter.\n",
);
process.exit(1);
