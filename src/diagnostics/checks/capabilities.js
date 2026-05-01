const fs = require("fs");
const path = require("path");
const { createCheck, createGroup } = require("../schema");
const { readJsonFile } = require("../file-utils");
const { redactPath } = require("../redact");

function runTimelineCapabilityChecks(context) {
  const config = context.config || {};
  return createGroup({
    id: "capabilities.timeline",
    title: "Timeline",
    checks: [
      checkCommandConfigured("capabilities.timeline.command.configured", "Timeline command", config.timelineCommand || "timeline-for-agent"),
      checkJsonState(config.timelineScreenshotQueueFile, "capabilities.timeline.screenshot_queue", "Timeline screenshot queue"),
      checkChromePathHint(),
    ],
  });
}

function runWhereaboutsCapabilityChecks(context) {
  const config = context.config || {};
  return createGroup({
    id: "capabilities.whereabouts",
    title: "Whereabouts",
    checks: [
      createCheck({
        id: config.startWithLocationServer ? "capabilities.whereabouts.server.enabled" : "capabilities.whereabouts.server.disabled",
        title: "Whereabouts server enabled flag",
        status: "ok",
        category: "capability",
        evidence: { enabled: Boolean(config.startWithLocationServer) },
      }),
      createCheck({
        id: config.locationToken ? "capabilities.whereabouts.token.present" : "capabilities.whereabouts.token.missing",
        title: "Whereabouts ingest token",
        status: config.startWithLocationServer && !config.locationToken ? "warn" : "ok",
        category: "capability",
        evidence: { hasToken: Boolean(config.locationToken) },
        recommendation: config.startWithLocationServer && !config.locationToken ? "Set CYBERBOSS_LOCATION_TOKEN before enabling the location server." : "",
      }),
      checkJsonState(config.locationStoreFile, "capabilities.whereabouts.location_store", "Whereabouts store"),
    ],
  });
}

function runStickerCapabilityChecks(context) {
  const config = context.config || {};
  const options = context.options || {};
  return createGroup({
    id: "capabilities.stickers",
    title: "Stickers",
    checks: [
      checkJsonState(config.stickersTemplateIndexFile, "capabilities.stickers.template_index", "Template sticker index"),
      checkJsonState(config.stickerTagsTemplateFile, "capabilities.stickers.template_tags", "Template sticker tags"),
      checkStickerAssetCount(config, options),
      checkJsonState(config.stickersIndexFile, "capabilities.stickers.local_index", "Local sticker index", { missingStatus: "warn" }),
      checkJsonState(config.stickerTagsFile, "capabilities.stickers.local_tags", "Local sticker tags", { missingStatus: "warn" }),
    ],
  });
}

function runCheckinCapabilityChecks(context) {
  const config = context.config || {};
  const target = resolveCheckinTarget(config);
  return createGroup({
    id: "capabilities.checkin",
    title: "Check-in",
    checks: [
      createCheck({
        id: config.startWithCheckin ? "capabilities.checkin.enabled" : "capabilities.checkin.disabled",
        title: "Check-in enabled flag",
        status: "ok",
        category: "capability",
        evidence: { enabled: Boolean(config.startWithCheckin) },
      }),
      createCheck({
        id: target ? "capabilities.checkin.target_user.resolved" : "capabilities.checkin.target_user.unresolved",
        title: "Check-in target user",
        status: config.startWithCheckin && !target ? "warn" : "ok",
        category: "capability",
        evidence: { resolved: Boolean(target), startWithCheckin: Boolean(config.startWithCheckin) },
        recommendation: config.startWithCheckin && !target ? "Set CYBERBOSS_CHECKIN_USER_ID or CYBERBOSS_ALLOWED_USER_IDS, or bind exactly one WeChat user." : "",
      }),
      checkJsonState(config.checkinConfigFile, "capabilities.checkin.config", "Check-in config"),
      checkJsonState(config.systemMessageQueueFile, "capabilities.checkin.system_queue", "System message queue"),
    ],
  });
}

function runDiaryReminderSystemCapabilityChecks(context) {
  const config = context.config || {};
  const options = context.options || {};
  return createGroup({
    id: "capabilities.diary_reminder_system",
    title: "Diary, Reminders, And System Queue",
    checks: [
      createCheck({
        id: "capabilities.diary.directory",
        title: "Diary directory",
        status: "ok",
        category: "capability",
        evidence: { exists: fs.existsSync(config.diaryDir || ""), diaryDir: redactPath(config.diaryDir, options) },
      }),
      checkJsonState(config.reminderQueueFile, "capabilities.reminder.queue", "Reminder queue"),
      checkJsonState(config.systemMessageQueueFile, "capabilities.system.queue", "System queue"),
      checkJsonState(config.deferredSystemReplyQueueFile, "capabilities.system.deferred_replies", "Deferred system replies"),
    ],
  });
}

function checkCommandConfigured(id, title, command) {
  return createCheck({
    id,
    title,
    status: command ? "ok" : "warn",
    category: "capability",
    evidence: { configured: Boolean(command), command: command || "" },
  });
}

function checkJsonState(filePath, idBase, title, { missingStatus = "ok" } = {}) {
  const parsed = readJsonFile(filePath || "");
  if (!parsed.exists) {
    return createCheck({ id: `${idBase}.missing`, title, status: missingStatus, category: "capability", evidence: { exists: false } });
  }
  if (!parsed.ok) {
    return createCheck({
      id: `${idBase}.invalid_json`,
      title,
      status: "fail",
      category: "capability",
      evidence: { exists: true, ok: false },
      recommendation: `Repair or replace ${title}.`,
    });
  }
  return createCheck({
    id: `${idBase}.valid`,
    title,
    status: "ok",
    category: "capability",
    evidence: { exists: true, itemCount: Array.isArray(parsed.data) ? parsed.data.length : Object.keys(parsed.data || {}).length },
  });
}

function checkStickerAssetCount(config, options) {
  const dir = config.stickerAssetsDir || path.join(config.stickersDir || "", "assets");
  if (!fs.existsSync(dir)) {
    return createCheck({
      id: "capabilities.stickers.assets.summary",
      title: "Sticker assets",
      status: "ok",
      category: "capability",
      evidence: { exists: false, assetCount: 0, dir: redactPath(dir, options) },
    });
  }
  let stat = null;
  try {
    stat = fs.statSync(dir);
  } catch (error) {
    return createCheck({
      id: "capabilities.stickers.assets.unreadable",
      title: "Sticker assets",
      status: "warn",
      category: "capability",
      evidence: { exists: true, errorCode: error?.code || "stat_error", dir: redactPath(dir, options) },
      recommendation: "Inspect the sticker assets path; Doctor could not stat it.",
    });
  }
  if (!stat.isDirectory()) {
    return createCheck({
      id: "capabilities.stickers.assets.unreadable",
      title: "Sticker assets",
      status: "warn",
      category: "capability",
      evidence: { exists: true, type: stat.isFile() ? "file" : "other", dir: redactPath(dir, options) },
      recommendation: "Set stickerAssetsDir to a directory or remove the mistyped path.",
    });
  }
  let count = 0;
  try {
    count = fs.readdirSync(dir).filter((name) => /\.(gif|png|jpe?g|webp)$/i.test(name)).length;
  } catch (error) {
    return createCheck({
      id: "capabilities.stickers.assets.unreadable",
      title: "Sticker assets",
      status: "warn",
      category: "capability",
      evidence: { exists: true, errorCode: error?.code || "read_error", dir: redactPath(dir, options) },
      recommendation: "Ensure the sticker assets directory is readable by the current Linux user.",
    });
  }
  return createCheck({
    id: "capabilities.stickers.assets.summary",
    title: "Sticker assets",
    status: "ok",
    category: "capability",
    evidence: { exists: fs.existsSync(dir), assetCount: count, dir: redactPath(dir, options) },
  });
}

function checkChromePathHint() {
  const configured = process.env.TIMELINE_FOR_AGENT_CHROME_PATH || process.env.CYBERBOSS_SCREENSHOT_CHROME_PATH || "";
  return createCheck({
    id: configured ? "capabilities.timeline.chrome_path.configured" : "capabilities.timeline.chrome_path.not_configured",
    title: "Timeline screenshot Chrome path",
    status: configured ? "ok" : "warn",
    category: "capability",
    evidence: { configured: Boolean(configured), platform: process.platform },
    recommendation: configured ? "" : "Set TIMELINE_FOR_AGENT_CHROME_PATH or CYBERBOSS_SCREENSHOT_CHROME_PATH in Linux if screenshots fail.",
  });
}

function resolveCheckinTarget(config) {
  if (normalizeText(process.env.CYBERBOSS_CHECKIN_USER_ID)) {
    return normalizeText(process.env.CYBERBOSS_CHECKIN_USER_ID);
  }
  const allowed = Array.isArray(config.allowedUserIds) ? config.allowedUserIds.filter(Boolean) : [];
  if (allowed.length) {
    return allowed[0];
  }
  const accounts = listAccounts(config);
  if (accounts.length === 1 && accounts[0].userId) {
    return accounts[0].userId;
  }
  return "";
}

function listAccounts(config) {
  if (!config.accountsDir || !fs.existsSync(config.accountsDir)) {
    return [];
  }
  return fs.readdirSync(config.accountsDir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".context-tokens.json"))
    .map((name) => readJsonFile(path.join(config.accountsDir, name)).data)
    .filter((item) => item && typeof item === "object");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  runCheckinCapabilityChecks,
  runDiaryReminderSystemCapabilityChecks,
  runStickerCapabilityChecks,
  runTimelineCapabilityChecks,
  runWhereaboutsCapabilityChecks,
};
