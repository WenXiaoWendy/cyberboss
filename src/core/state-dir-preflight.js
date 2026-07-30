const fs = require("fs");
const path = require("path");

const GUARDED_MODES = new Set(["login", "accounts", "start", "shared:start"]);

function assertSafeBetaStateDir({
  safeBeta,
  mode,
  stateDir,
  defaultStateDir,
  stateEnvLoaded,
  inheritedStateDir,
  requireInherited = false,
}) {
  if (!safeBeta || !GUARDED_MODES.has(mode)) {
    return;
  }

  const normalizedStateDir = normalizeAbsolute(stateDir);
  const normalizedDefaultStateDir = normalizeAbsolute(defaultStateDir);
  if (!normalizedStateDir || normalizedStateDir === normalizedDefaultStateDir) {
    throw new Error("Safe Beta state directory must be an explicit custom directory.");
  }
  if (!fs.existsSync(normalizedStateDir) || !fs.statSync(normalizedStateDir).isDirectory()) {
    throw new Error("Safe Beta custom state directory is unavailable.");
  }
  try {
    fs.accessSync(normalizedStateDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new Error("Safe Beta custom state directory is not readable and writable.");
  }
  if (!stateEnvLoaded) {
    throw new Error("Safe Beta custom state directory .env is unavailable.");
  }

  if (requireInherited) {
    const normalizedInherited = normalizeAbsolute(inheritedStateDir);
    if (!normalizedInherited) {
      throw new Error("Safe Beta state directory was not inherited by the CLI child process.");
    }
    if (normalizedInherited !== normalizedStateDir) {
      throw new Error("Safe Beta state directory changed before CLI dispatch.");
    }
  }
}

function normalizeAbsolute(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? path.resolve(normalized) : "";
}

module.exports = {
  GUARDED_MODES,
  assertSafeBetaStateDir,
};
