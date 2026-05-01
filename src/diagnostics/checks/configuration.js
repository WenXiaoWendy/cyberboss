const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCheck, createGroup } = require("../schema");
const { redactId, redactPath } = require("../redact");

function runConfigurationChecks(context) {
  const config = context.config || {};
  const options = context.options || {};
  const checks = [
    checkRuntime(config),
    checkChannel(config),
    checkWorkspaceRoot(config, options),
    checkEnvSources(options),
    checkAllowedUsers(config, options),
    checkIntegerConfig("configuration.weixin_min_chunk_chars", "WeChat chunk minimum", config.weixinMinChunkChars, { min: 1, max: 3800 }),
    checkIntegerConfig("configuration.location_port", "Location port", config.locationPort, { min: 1, max: 65535 }),
  ];

  return createGroup({ id: "configuration", title: "Configuration", checks });
}

function checkRuntime(config) {
  const runtime = normalizeText(config.runtime) || "codex";
  const ok = runtime === "codex" || runtime === "claudecode";
  return createCheck({
    id: ok ? "configuration.runtime.recognized" : "configuration.runtime.unrecognized",
    title: "Runtime",
    status: ok ? "ok" : "fail",
    category: "config",
    evidence: { runtime },
    recommendation: ok ? "" : "Set CYBERBOSS_RUNTIME to codex or claudecode.",
  });
}

function checkChannel(config) {
  const channel = normalizeText(config.channel) || "weixin";
  const ok = channel === "weixin";
  return createCheck({
    id: ok ? "configuration.channel.recognized" : "configuration.channel.unrecognized",
    title: "Channel",
    status: ok ? "ok" : "fail",
    category: "config",
    evidence: { channel },
    recommendation: ok ? "" : "Set CYBERBOSS_CHANNEL to weixin.",
  });
}

function checkWorkspaceRoot(config, options) {
  const workspaceRoot = normalizeText(config.workspaceRoot);
  const exists = workspaceRoot && fs.existsSync(workspaceRoot);
  const isDirectory = exists && fs.statSync(workspaceRoot).isDirectory();
  const ok = Boolean(isDirectory);
  return createCheck({
    id: ok ? "configuration.workspace_root.ok" : "configuration.workspace_root.missing",
    title: "Workspace root",
    status: ok ? "ok" : "fail",
    category: "config",
    evidence: {
      workspaceRoot: redactPath(workspaceRoot, options),
      exists: Boolean(exists),
      isDirectory: Boolean(isDirectory),
    },
    recommendation: ok ? "" : "Set CYBERBOSS_WORKSPACE_ROOT to an existing Linux directory.",
  });
}

function checkEnvSources(options) {
  const projectEnv = path.join(process.cwd(), ".env");
  const homeEnv = path.join(os.homedir(), ".cyberboss", ".env");
  const projectExists = fs.existsSync(projectEnv);
  const homeExists = fs.existsSync(homeEnv);
  return createCheck({
    id: "configuration.env_sources.present",
    title: "Environment source files",
    status: projectExists || homeExists ? "ok" : "warn",
    category: "config",
    evidence: {
      projectEnv: projectExists,
      homeEnv: redactPath(homeEnv, options),
      homeEnvExists: homeExists,
      activeFilePrecedence: projectExists ? "project" : homeExists ? "home" : "shell_or_default",
    },
    privacy: { redacted: true, unsafeFieldsAvailable: ["homeEnv"] },
    recommendation: projectExists || homeExists ? "" : "Create a project .env or ~/.cyberboss/.env for persistent configuration.",
  });
}

function checkAllowedUsers(config, options) {
  const ids = Array.isArray(config.allowedUserIds) ? config.allowedUserIds.filter(Boolean) : [];
  return createCheck({
    id: "configuration.allowed_user_ids.summary",
    title: "Allowed WeChat users",
    status: ids.length ? "ok" : "warn",
    category: "config",
    evidence: {
      count: ids.length,
      ids: ids.map((id) => redactId(id, options)),
    },
    recommendation: ids.length ? "" : "Set CYBERBOSS_ALLOWED_USER_IDS for a tighter bridge boundary.",
  });
}

function checkIntegerConfig(id, title, value, { min, max }) {
  if (value === undefined || value === null || value === "") {
    return createCheck({ id: `${id}.default`, title, status: "ok", category: "config", evidence: { configured: false } });
  }
  const parsed = Number.parseInt(String(value), 10);
  const ok = Number.isInteger(parsed) && parsed >= min && parsed <= max;
  return createCheck({
    id: ok ? `${id}.ok` : `${id}.invalid`,
    title,
    status: ok ? "ok" : "warn",
    category: "config",
    evidence: { value: parsed, min, max },
    recommendation: ok ? "" : `Set ${title} to an integer between ${min} and ${max}.`,
  });
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { runConfigurationChecks };
