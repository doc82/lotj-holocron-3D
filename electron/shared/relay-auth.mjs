import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function ensureRelayToken(tokenPath) {
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const token = randomBytes(32).toString("hex");
  const temporary = `${tokenPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, tokenPath);
  return token;
}

export function validateRelayAuth(message, expectedToken) {
  if (
    !message ||
    message.v !== 1 ||
    message.type !== "relay_auth" ||
    typeof message.token !== "string"
  )
    return false;
  const actual = Buffer.from(message.token, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
