const fs = require("fs");
const os = require("os");
const path = require("path");

function loadCyberbossEnv({
  cwd = process.cwd(),
  defaultStateDir = path.join(os.homedir(), ".cyberboss"),
  baseEnv = process.env,
} = {}) {
  const inherited = { ...baseEnv };
  const cwdValues = readEnvFile(path.join(cwd, ".env"));
  const configuredStateDir = normalizeText(inherited.CYBERBOSS_STATE_DIR)
    || normalizeText(cwdValues.CYBERBOSS_STATE_DIR);
  const customState = configuredStateDir && path.resolve(configuredStateDir) !== path.resolve(defaultStateDir);
  const stateValues = readEnvFile(path.join(configuredStateDir || defaultStateDir, ".env"));

  if (customState) {
    return { ...cwdValues, ...stateValues, ...inherited, CYBERBOSS_STATE_DIR: configuredStateDir };
  }
  return { ...stateValues, ...cwdValues, ...inherited };
}

function applyCyberbossEnv(options = {}) {
  const loaded = loadCyberbossEnv(options);
  for (const [name, value] of Object.entries(loaded)) {
    process.env[name] = value;
  }
  return loaded;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return {};
  }
  return parseEnv(fs.readFileSync(filePath, "utf8"));
}

function parseEnv(content) {
  try {
    return require("dotenv").parse(content);
  } catch {
    // Keep pre-install validation available without changing runtime precedence.
  }
  const values = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (name) {
      values[name] = value;
    }
  }
  return values;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { applyCyberbossEnv, loadCyberbossEnv };
