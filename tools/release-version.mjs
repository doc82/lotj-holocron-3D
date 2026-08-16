import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function parseVersion(value, label) {
  const version = String(value || "").trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(
      `${label} must use numeric MAJOR.MINOR.PATCH format; received ${version || "nothing"}.`,
    );
  }
  return version;
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function decideRelease({
  currentVersion,
  previousVersion,
  requestedVersion,
  manual = false,
}) {
  const current = parseVersion(currentVersion, "package.json version");
  if (manual) {
    const requested = requestedVersion
      ? parseVersion(requestedVersion, "requested release version")
      : current;
    if (requested !== current) {
      throw new Error(
        `Requested version ${requested} does not match package.json version ${current}.`,
      );
    }
    return { release: true, version: current, tag: `v${current}` };
  }

  const previous = parseVersion(previousVersion, "previous package.json version");
  if (current === previous) return { release: false, version: current, tag: `v${current}` };
  if (compareVersions(current, previous) < 1) {
    throw new Error(`package.json version must increase (${previous} -> ${current}).`);
  }
  return { release: true, version: current, tag: `v${current}` };
}

function previousPackageVersion(ref) {
  if (!/^[0-9a-f]{40}$/i.test(ref || ""))
    throw new Error("Push event did not provide a valid before SHA.");
  const content = execFileSync("git", ["show", `${ref}:package.json`], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(content).version;
}

function writeOutputs(decision) {
  const lines = [
    `release=${decision.release}`,
    `version=${decision.version}`,
    `tag=${decision.tag}`,
  ];
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  } else {
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const manual = process.env.RELEASE_EVENT === "workflow_dispatch";
  const decision = decideRelease({
    currentVersion: manifest.version,
    previousVersion: manual
      ? manifest.version
      : previousPackageVersion(process.env.RELEASE_BEFORE_SHA),
    requestedVersion: process.env.RELEASE_REQUESTED_VERSION,
    manual,
  });
  writeOutputs(decision);
}
