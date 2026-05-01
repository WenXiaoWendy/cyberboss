const fs = require("fs");
const { createCheck, createGroup } = require("../schema");
const { inspectPath, readJsonFile } = require("../file-utils");

const JSON_FILES = [
  ["sessionsFile", "sessions_json", "Sessions"],
  ["weixinConfigFile", "weixin_config_json", "WeChat config"],
  ["checkinConfigFile", "checkin_config_json", "Check-in config"],
  ["systemMessageQueueFile", "system_message_queue_json", "System message queue"],
  ["deferredSystemReplyQueueFile", "deferred_system_replies_json", "Deferred system replies"],
  ["timelineScreenshotQueueFile", "timeline_screenshot_queue_json", "Timeline screenshot queue"],
  ["projectToolContextFile", "project_tool_context_json", "Project tool runtime context"],
  ["locationStoreFile", "locations_json", "Locations"],
];

function runStateChecks(context) {
  const config = context.config || {};
  const options = context.options || {};
  const checks = [
    checkStateDir(config, options),
    ...JSON_FILES.map(([configKey, idPart, title]) => checkJsonFile(config, options, configKey, idPart, title)),
  ];
  return createGroup({ id: "state", title: "State", checks });
}

function checkStateDir(config, options) {
  const summary = inspectPath(config.stateDir, options);
  const ok = summary.exists && summary.type === "directory" && summary.readable && summary.writable;
  return createCheck({
    id: ok ? "state.directory.ok" : "state.directory.unavailable",
    title: "State directory",
    status: ok ? "ok" : "fail",
    category: "state",
    evidence: summary,
    recommendation: ok ? "" : "Ensure CYBERBOSS_STATE_DIR exists and is readable/writable by the current Linux user.",
  });
}

function checkJsonFile(config, options, configKey, idPart, title) {
  const filePath = config[configKey];
  if (!filePath || !fs.existsSync(filePath)) {
    return createCheck({
      id: `state.${idPart}.missing`,
      title,
      status: "ok",
      category: "state",
      evidence: { exists: false },
    });
  }
  const parsed = readJsonFile(filePath);
  if (!parsed.ok) {
    return createCheck({
      id: `state.${idPart}.invalid`,
      title,
      status: "fail",
      category: "state",
      evidence: { exists: true, ok: false, errorCode: parsed.errorCode },
      recommendation: `Inspect or replace the corrupted ${title} JSON file.`,
    });
  }
  return createCheck({
    id: `state.${idPart}.valid`,
    title,
    status: "ok",
    category: "state",
    evidence: {
      exists: true,
      ok: true,
      itemCount: summarizeJsonCount(parsed.data),
    },
  });
}

function summarizeJsonCount(value) {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length;
  }
  return 0;
}

module.exports = { runStateChecks };
