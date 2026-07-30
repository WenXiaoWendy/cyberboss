const fs = require("fs");
const os = require("os");
const path = require("path");

function loadCyberbossEnv({
  cwd = process.cwd(),
  defaultStateDir = path.join(os.homedir(), ".cyberboss"),
  baseEnv = process.env,
} = {}) {
  return resolveCyberbossEnv({ cwd, defaultStateDir, baseEnv }).env;
}

function resolveCyberbossEnv({
  cwd = process.cwd(),
  defaultStateDir = path.join(os.homedir(), ".cyberboss"),
  baseEnv = process.env,
} = {}) {
  const inherited = { ...baseEnv };
  const cwdValues = readEnvFile(path.join(cwd, ".env"));
  const inheritedStateDir = normalizeText(inherited.CYBERBOSS_STATE_DIR);
  const cwdStateDir = normalizeText(cwdValues.CYBERBOSS_STATE_DIR);
  if (inheritedStateDir && cwdStateDir
    && resolveFrom(cwd, inheritedStateDir) !== resolveFrom(cwd, cwdStateDir)) {
    throw new Error("Cyberboss state directory configuration conflicts between the process and workspace .env.");
  }

  const configuredStateDir = inheritedStateDir || cwdStateDir;
  const resolvedDefaultStateDir = path.resolve(defaultStateDir);
  const resolvedStateDir = configuredStateDir
    ? resolveFrom(cwd, configuredStateDir)
    : resolvedDefaultStateDir;
  const customState = resolvedStateDir !== resolvedDefaultStateDir;
  const stateEnvFile = path.join(resolvedStateDir, ".env");
  const stateValues = readEnvFile(stateEnvFile);

  if (customState) {
    return {
      env: {
        ...cwdValues,
        ...stateValues,
        ...inherited,
        CYBERBOSS_STATE_DIR: resolvedStateDir,
      },
      stateDir: resolvedStateDir,
      defaultStateDir: resolvedDefaultStateDir,
      customState,
      stateEnvLoaded: fs.existsSync(stateEnvFile) && fs.statSync(stateEnvFile).isFile(),
      inheritedStateDirSet: Boolean(inheritedStateDir),
    };
  }
  return {
    env: { ...stateValues, ...cwdValues, ...inherited },
    stateDir: resolvedStateDir,
    defaultStateDir: resolvedDefaultStateDir,
    customState,
    stateEnvLoaded: fs.existsSync(stateEnvFile) && fs.statSync(stateEnvFile).isFile(),
    inheritedStateDirSet: Boolean(inheritedStateDir),
  };
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

function resolveFrom(cwd, value) {
  return path.resolve(cwd, value);
}

module.exports = {
  applyCyberbossEnv,
  loadCyberbossEnv,
  resolveCyberbossEnv,
};
