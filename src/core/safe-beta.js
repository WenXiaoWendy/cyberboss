const fs = require("fs");
const path = require("path");

const SAFE_MEMORY_TOOLS = Object.freeze([
  "breath",
  "recall",
  "get_source",
  "memory_trigger",
  "ferry",
]);
const SAFE_MEMORY_SERVER = "xingxing-memory";
const SAFE_BETA_WEIXIN_CARRIER = "weixin";
const SAFE_CODEX_ENV_ALLOWLIST = Object.freeze([
  // Process startup and executable discovery on supported platforms.
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "ComSpec",
  "PATHEXT",
  // The official Codex CLI reads local configuration and authentication from
  // CODEX_HOME. A real Windows initialize succeeds without forwarding the
  // parent HOME, USERPROFILE, APPDATA, or LOCALAPPDATA values.
  "CODEX_HOME",
]);

function isSafeBetaEnabled(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function resolveSafeBetaConfig(config) {
  if (!config?.safeBeta) {
    return { ...config };
  }
  return {
    ...config,
    startWithCheckin: false,
    startWithLocationServer: false,
    enableRandomWake: false,
    enableSystemMessages: false,
    enableProjectTools: false,
    runtime: "codex",
    visionMode: "off",
    codexAccessMode: "read-only",
    codexApprovalPolicy: "on-request",
    codexNetworkAccess: false,
  };
}

function buildSafeCodexEnv(baseEnv = process.env) {
  const env = {};
  for (const name of SAFE_CODEX_ENV_ALLOWLIST) {
    if (typeof baseEnv?.[name] === "string" && baseEnv[name]) {
      env[name] = baseEnv[name];
    }
  }
  return env;
}

function assertSafeBetaStartAllowed({ safeBeta, mode, allowedUserIds }) {
  if (!safeBeta || mode === "login") {
    return;
  }
  if ((mode === "start" || mode === "shared:start") && normalizeList(allowedUserIds).length === 0) {
    throw new Error("Safe Beta start refused: allowlist CYBERBOSS_ALLOWED_USER_IDS must contain at least one sender.");
  }
}

function validateMemoryMcpPaths({ pythonPath, memoryAgentRoot, databasePath }) {
  assertFile(pythonPath, "Python");
  assertDirectory(memoryAgentRoot, "Memory Agent root");
  assertFile(databasePath, "Memory SQLite");
  const modulePath = path.join(memoryAgentRoot, "src", "memory_agent", "mcp_server.py");
  if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
    throw new Error("Safe Beta Memory MCP module is missing.");
  }
  return {
    pythonPath: path.resolve(pythonPath),
    memoryAgentRoot: path.resolve(memoryAgentRoot),
    databasePath: path.resolve(databasePath),
  };
}

function buildMinimalMemoryMcpEnv(baseEnv, pythonPathRoot) {
  const env = {};
  for (const name of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "ComSpec",
    "PATHEXT",
  ]) {
    if (typeof baseEnv?.[name] === "string" && baseEnv[name]) {
      env[name] = baseEnv[name];
    }
  }
  env.PYTHONPATH = pythonPathRoot;
  env.PYTHONUTF8 = "1";
  env.PYTHONDONTWRITEBYTECODE = "1";
  return env;
}

function evaluateSafeMemoryMcpApproval(approval = {}) {
  const elicitation = approval?.elicitation && typeof approval.elicitation === "object"
    ? approval.elicitation
    : {};
  const serverName = normalizeText(elicitation.serverName);
  const toolName = normalizeText(elicitation.toolName);
  if (approval?.kind !== "mcp_tool_call" || serverName !== SAFE_MEMORY_SERVER) {
    return { allowed: false, reason: "server_not_allowed", toolName };
  }
  if (!SAFE_MEMORY_TOOLS.includes(toolName)) {
    return { allowed: false, reason: "tool_not_allowed", toolName };
  }
  if (toolName === "ferry") {
    const targetCarrier = findToolParam(elicitation.toolParamsDisplay, "target_carrier");
    if (targetCarrier !== SAFE_BETA_WEIXIN_CARRIER) {
      return { allowed: false, reason: "invalid_carrier", toolName };
    }
  }
  return { allowed: true, reason: "allowlisted_read_tool", toolName };
}

function findToolParam(values, name) {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const match = values.find((entry) => normalizeText(entry?.name) === name);
  return typeof match?.value === "string" ? match.value : match?.value;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeList(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function assertFile(filePath, label) {
  const normalized = typeof filePath === "string" ? filePath.trim() : "";
  if (!normalized || !fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    throw new Error(`Safe Beta ${label} is missing.`);
  }
}

function assertDirectory(directoryPath, label) {
  const normalized = typeof directoryPath === "string" ? directoryPath.trim() : "";
  if (!normalized || !fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    throw new Error(`Safe Beta ${label} is missing.`);
  }
}

module.exports = {
  SAFE_BETA_WEIXIN_CARRIER,
  SAFE_CODEX_ENV_ALLOWLIST,
  SAFE_MEMORY_TOOLS,
  assertSafeBetaStartAllowed,
  buildSafeCodexEnv,
  buildMinimalMemoryMcpEnv,
  evaluateSafeMemoryMcpApproval,
  isSafeBetaEnabled,
  resolveSafeBetaConfig,
  validateMemoryMcpPaths,
};
