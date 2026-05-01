const fs = require("fs");
const path = require("path");
const { createCheck, createGroup } = require("../schema");
const { redactPath } = require("../redact");

function runRuntimeChecks(context) {
  const config = context.config || {};
  const options = context.options || {};
  const runtime = normalizeText(config.runtime) || "codex";
  const checks = runtime === "claudecode"
    ? runClaudeCodeChecks(config, options)
    : runCodexChecks(config, options);
  return createGroup({ id: "runtime", title: "Runtime", checks });
}

function runCodexChecks(config, options) {
  const command = normalizeText(config.codexCommand) || "codex";
  return [
    createCheck({
      id: commandAvailable(command) ? "runtime.codex.command.available" : "runtime.codex.command.unavailable",
      title: "Codex launcher",
      status: commandAvailable(command) ? "ok" : "warn",
      category: "runtime",
      evidence: { command: redactCommand(command, options) },
      recommendation: commandAvailable(command) ? "" : "Install Codex or set CYBERBOSS_CODEX_COMMAND.",
    }),
    checkUrlShape("runtime.codex.endpoint", "Codex endpoint", config.codexEndpoint),
  ];
}

function runClaudeCodeChecks(config, options) {
  const command = normalizeText(config.claudeCommand) || "claude";
  const isDefault = command === "claude";
  return [
    createCheck({
      id: isDefault ? "runtime.claudecode.launcher.default_command" : "runtime.claudecode.launcher.custom_command",
      title: "Claude Code stream-json launcher",
      status: isDefault ? "ok" : "warn",
      category: "runtime",
      evidence: { command: redactCommand(command, options), compatibleFamily: "stream-json" },
      recommendation: isDefault ? "" : "Custom launchers such as ccswitch are treated as stream-json compatible but are not provider proof.",
    }),
    createCheck({
      id: commandAvailable(command) ? "runtime.claudecode.command.available" : "runtime.claudecode.command.unavailable",
      title: "Claude Code command availability",
      status: commandAvailable(command) ? "ok" : "warn",
      category: "runtime",
      evidence: { command: redactCommand(command, options) },
      recommendation: commandAvailable(command) ? "" : "Ensure the launcher is on PATH in the Linux environment.",
    }),
    checkContextWindow(config),
    createCheck({
      id: "runtime.claudecode.protocol.unprobed",
      title: "Claude Code protocol compatibility",
      status: "unknown",
      category: "runtime",
      evidence: { probe: "not_run", protocol: "stream-json" },
      recommendation: "A future --runtime-probe can verify launcher behavior with side effects.",
    }),
  ];
}

function checkContextWindow(config) {
  const window = Number(config.claudeContextWindow || 0);
  const reserve = Number(config.claudeMaxOutputTokens || 0);
  if (!window) {
    return createCheck({
      id: "runtime.claudecode.context_window.missing",
      title: "Claude Code context window",
      status: "warn",
      category: "runtime",
      evidence: { configured: false },
      recommendation: "Set CYBERBOSS_CLAUDE_CONTEXT_WINDOW if /status should report context usage.",
    });
  }
  return createCheck({
    id: reserve > window ? "runtime.claudecode.max_output_tokens.exceeds_context" : "runtime.claudecode.context_window.ok",
    title: "Claude Code context window",
    status: reserve > window ? "warn" : "ok",
    category: "runtime",
    evidence: { contextWindow: window, maxOutputTokens: reserve },
    recommendation: reserve > window ? "Reduce CLAUDE_CODE_MAX_OUTPUT_TOKENS below CYBERBOSS_CLAUDE_CONTEXT_WINDOW." : "",
  });
}

function checkUrlShape(idBase, title, value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return createCheck({ id: `${idBase}.not_configured`, title, status: "ok", category: "runtime", evidence: { configured: false } });
  }
  try {
    const url = new URL(normalized);
    const ok = url.protocol === "ws:" || url.protocol === "wss:" || url.protocol === "http:" || url.protocol === "https:";
    return createCheck({
      id: ok ? `${idBase}.valid` : `${idBase}.invalid`,
      title,
      status: ok ? "ok" : "warn",
      category: "runtime",
      evidence: { protocol: url.protocol, host: url.host },
    });
  } catch {
    return createCheck({ id: `${idBase}.invalid`, title, status: "warn", category: "runtime", evidence: { valid: false } });
  }
}

function commandAvailable(command) {
  const normalized = normalizeText(command);
  if (!normalized) {
    return false;
  }
  if (normalized.includes(path.sep)) {
    return fs.existsSync(normalized);
  }
  const pathEntries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return pathEntries.some((entry) => fs.existsSync(path.join(entry, normalized)));
}

function redactCommand(command, options) {
  const normalized = normalizeText(command);
  return normalized.includes(path.sep) ? redactPath(normalized, options) : normalized;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { runRuntimeChecks };
