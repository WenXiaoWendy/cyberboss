const fs = require("fs");
const path = require("path");
const {
  SAFE_MEMORY_TOOLS,
  buildMinimalMemoryMcpEnv,
  validateMemoryMcpPaths,
} = require("../../../core/safe-beta");

function resolveCodexProjectToolMcpServerConfig({ cyberbossHome = "" } = {}) {
  const home = normalizeNonEmptyString(cyberbossHome)
    || process.env.CYBERBOSS_HOME
    || path.resolve(__dirname, "..", "..", "..", "..");
  const scriptPath = path.join(home, "bin", "cyberboss.js");
  if (!fs.existsSync(scriptPath)) {
    return null;
  }
  return {
    name: "cyberboss_tools",
    command: process.execPath,
    args: [scriptPath, "tool-mcp-server", "--runtime-id", "codex"],
    autoApproveProjectTools: true,
  };
}

function resolveSafeBetaMemoryMcpServerConfig({
  pythonPath,
  memoryAgentRoot,
  databasePath,
  baseEnv = process.env,
} = {}) {
  const paths = validateMemoryMcpPaths({ pythonPath, memoryAgentRoot, databasePath });
  return {
    name: "xingxing-memory",
    command: paths.pythonPath,
    args: ["-m", "memory_agent.mcp_server", "--db", paths.databasePath],
    cwd: paths.memoryAgentRoot,
    env: buildMinimalMemoryMcpEnv(baseEnv, path.join(paths.memoryAgentRoot, "src")),
    required: true,
    enabledTools: [...SAFE_MEMORY_TOOLS],
    approvalModeByTool: {
      breath: "auto",
      recall: "auto",
      get_source: "auto",
      memory_trigger: "auto",
      ferry: "auto",
    },
    exclusive: true,
  };
}

function buildCodexMcpConfigArgs(mcpServerConfig) {
  if (!mcpServerConfig || typeof mcpServerConfig !== "object") {
    return [];
  }
  const name = normalizeNonEmptyString(mcpServerConfig.name) || "cyberboss_tools";
  const command = normalizeNonEmptyString(mcpServerConfig.command);
  const args = Array.isArray(mcpServerConfig.args)
    ? mcpServerConfig.args.map((value) => normalizeNonEmptyString(value)).filter(Boolean)
    : [];
  if (!command) {
    return [];
  }
  const configArgs = [
    ...(mcpServerConfig.exclusive ? ["-c", "mcp_servers={}"] : []),
    "-c",
    `mcp_servers.${name}.command=${quoteTomlString(command)}`,
    "-c",
    `mcp_servers.${name}.args=${formatTomlArray(args)}`,
  ];
  const cwd = normalizeNonEmptyString(mcpServerConfig.cwd);
  if (cwd) {
    configArgs.push("-c", `mcp_servers.${name}.cwd=${quoteTomlString(cwd)}`);
  }
  if (mcpServerConfig.required === true) {
    configArgs.push("-c", `mcp_servers.${name}.required=true`);
  }
  const enabledTools = Array.isArray(mcpServerConfig.enabledTools)
    ? mcpServerConfig.enabledTools.map(normalizeNonEmptyString).filter(Boolean)
    : [];
  if (enabledTools.length) {
    configArgs.push("-c", `mcp_servers.${name}.enabled_tools=${formatTomlArray(enabledTools)}`);
  }
  const env = mcpServerConfig.env && typeof mcpServerConfig.env === "object"
    ? mcpServerConfig.env
    : {};
  for (const [envName, envValue] of Object.entries(env)) {
    if (!normalizeNonEmptyString(envName) || typeof envValue !== "string") {
      continue;
    }
    configArgs.push(
      "-c",
      `mcp_servers.${name}.env.${quoteTomlKey(envName)}=${quoteTomlString(envValue)}`,
    );
  }
  const autoApproveProjectTools = mcpServerConfig.autoApproveProjectTools === true
    || (mcpServerConfig.autoApproveProjectTools !== false && name === "cyberboss_tools");
  const toolNames = autoApproveProjectTools
    ? require("../../../tools/tool-host").listProjectToolNames()
    : Object.keys(mcpServerConfig.approvalModeByTool || {});
  for (const toolName of toolNames) {
    const approvalMode = autoApproveProjectTools
      ? "auto"
      : normalizeNonEmptyString(mcpServerConfig.approvalModeByTool[toolName]);
    if (!approvalMode) {
      continue;
    }
    configArgs.push(
      "-c",
      `mcp_servers.${name}.tools.${toolName}.approval_mode=${quoteTomlString(approvalMode)}`,
    );
  }
  return configArgs;
}

function quoteTomlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function formatTomlArray(values) {
  return `[${values.map((value) => quoteTomlString(value)).join(",")}]`;
}

function quoteTomlKey(value) {
  return JSON.stringify(String(value ?? ""));
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  buildCodexMcpConfigArgs,
  resolveCodexProjectToolMcpServerConfig,
  resolveSafeBetaMemoryMcpServerConfig,
};
