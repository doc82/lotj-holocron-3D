import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const checkOnly = process.argv.includes("--check");
const relayDirectory = resolve("relay");

function collectGoFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "bin" || entry.name === "vendor" ? [] : collectGoFiles(path);
    }

    return entry.isFile() && entry.name.endsWith(".go") ? [path] : [];
  });
}

const files = collectGoFiles(relayDirectory);
const result = spawnSync("gofmt", [checkOnly ? "-l" : "-w", ...files], {
  encoding: "utf8",
});

if (result.error) {
  console.error(`Unable to run gofmt: ${result.error.message}`);
  process.exit(1);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const unformattedFiles = result.stdout.trim();
if (checkOnly && unformattedFiles) {
  console.error("The following Go files need formatting:");
  console.error(unformattedFiles);
  console.error("Run `pnpm format:go` to fix them.");
  process.exit(1);
}
