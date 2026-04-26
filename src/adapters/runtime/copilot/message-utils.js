// Adapt SDK PermissionRequest payloads into the field set used by
// `runtime.approval.requested`: `{ command, filePath, filePaths,
// commandTokens, toolName }`. SDK PermissionRequest is a discriminated
// union by `kind`:
//   shell | write | read | mcp | url | memory | custom-tool | hook
// Each kind carries kind-specific fields (shell.fullCommandText,
// write.fileName, read.path, mcp.{serverName,toolName,args}, ...). We
// extract per-kind so the downstream approval prompt shows a meaningful
// tool name + payload.

const {
  buildApprovalCommandPreview,
  normalizeCommandTokens,
} = require("../shared/approval-command");

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function tokenizeCommandText(text) {
  if (!text) return [];
  return normalizeCommandTokens(text.split(/\s+/).filter(Boolean));
}

function deriveToolName(request) {
  if (!request || typeof request !== "object") return "";
  const kind = normalizeString(request.kind);
  if (!kind) return "";

  if (kind === "mcp") {
    const server = normalizeString(request.serverName);
    const tool = normalizeString(request.toolTitle || request.toolName);
    if (server && tool) return `mcp:${server}/${tool}`;
    return tool || `mcp:${server}` || "mcp";
  }
  if (kind === "custom-tool") {
    return normalizeString(request.toolName || request.toolTitle) || "custom-tool";
  }
  if (kind === "memory") {
    const action = normalizeString(request.action);
    return action ? `memory:${action}` : "memory";
  }
  return kind;
}

function buildApprovalFields(request) {
  const toolName = deriveToolName(request);
  const kind = normalizeString(request && request.kind);

  let command = "";
  let filePath = "";
  let filePaths = [];
  let commandTokens = [];

  if (kind === "shell") {
    command = normalizeString(request.fullCommandText);
    commandTokens = tokenizeCommandText(command);
    filePaths = Array.isArray(request.possiblePaths)
      ? request.possiblePaths.filter((p) => typeof p === "string" && p)
      : [];
    if (filePaths.length === 1) filePath = filePaths[0];
  } else if (kind === "write") {
    filePath = normalizeString(request.fileName);
    if (filePath) filePaths = [filePath];
  } else if (kind === "read") {
    filePath = normalizeString(request.path);
    if (filePath) filePaths = [filePath];
  } else if (kind === "url") {
    command = normalizeString(request.url);
  } else if (kind === "mcp" || kind === "custom-tool") {
    const args = (request && request.args && typeof request.args === "object") ? request.args : null;
    if (args) {
      command = buildApprovalCommandPreview([toolName, JSON.stringify(args)]);
    } else {
      command = toolName;
    }
  } else if (kind === "memory") {
    command = normalizeString(request.fact);
  }

  return {
    command,
    filePath,
    filePaths,
    commandTokens,
    toolName,
  };
}

module.exports = { buildApprovalFields };
