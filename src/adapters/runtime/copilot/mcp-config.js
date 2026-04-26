const fs = require("fs");
const path = require("path");

// Mirrors `codex/mcp-config.js`: resolves the spawn config that points the
// copilot SDK session at the cyberboss MCP server (`bin/cyberboss.js
// tool-mcp-server`). Returning null lets callers skip wiring entirely when
// the entrypoint is missing (e.g. exotic install layouts) instead of
// surfacing a confusing spawn failure later.
function resolveCopilotProjectToolMcpServerConfig({ cyberbossHome = "" } = {}) {
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
    args: [scriptPath, "tool-mcp-server", "--runtime-id", "copilot"],
  };
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  resolveCopilotProjectToolMcpServerConfig,
};
