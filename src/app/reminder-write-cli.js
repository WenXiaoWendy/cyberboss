const crypto = require("crypto");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { loadPersistedContextTokens } = require("../adapters/channel/weixin/context-token-store");
const { ReminderQueueStore } = require("../adapters/channel/weixin/reminder-queue-store");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { resolvePreferredSenderId } = require("../core/default-targets");

const DELAY_UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
};
const LOCAL_TIMEZONE_OFFSET = "+08:00";

async function runReminderWriteCommand(config) {
  const args = process.argv.slice(4);
  const options = parseArgs(args);
  const body = await resolveBody(options);
  if (!body) {
    throw new Error("提醒内容不能为空，传 --text 或通过 stdin 输入");
  }

  const dueAtMs = resolveDueAtMs(options);
  if (!Number.isFinite(dueAtMs) || dueAtMs <= Date.now()) {
    throw new Error("缺少有效时间，使用 --delay 30s|10m|1h30m|2d4h20m 或 --at 2026-04-07T21:30+08:00");
  }

  const account = resolveSelectedAccount(config);
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const senderId = resolvePreferredSenderId({
    config,
    accountId: account.accountId,
    explicitUser: options.user,
    sessionStore,
  });
  if (!senderId) {
    throw new Error("无法确定 reminder 的微信用户，传 --user 或先让唯一活跃用户和 bot 聊过一次");
  }

  const contextTokens = loadPersistedContextTokens(config, account.accountId);
  const contextToken = String(contextTokens[senderId] || "").trim();
  if (!contextToken) {
    throw new Error(`找不到 ${senderId} 的 context_token，先让这个用户和 bot 聊过一次`);
  }

  const queue = new ReminderQueueStore({ filePath: config.reminderQueueFile });
  const reminder = queue.enqueue({
    id: crypto.randomUUID(),
    accountId: account.accountId,
    senderId,
    contextToken,
    text: body,
    dueAtMs,
    createdAt: new Date().toISOString(),
  });
  console.log(`reminder queued: ${reminder.id}`);
}

function parseArgs(args) {
  const options = {
    delay: "",
    at: "",
    text: "",
    user: "",
    useStdin: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--delay") {
      options.delay = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--at") {
      options.at = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--text") {
      options.text = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--user") {
      options.user = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--stdin") {
      options.useStdin = true;
      continue;
    }
    throw new Error(`未知参数: ${arg}`);
  }
  return options;
}

function resolveDueAtMs(options) {
  const delayMs = parseDelay(options.delay);
  const scheduledAtMs = parseAbsoluteTime(options.at);
  if (delayMs && scheduledAtMs) {
    throw new Error("--delay 和 --at 不能同时传");
  }
  if (delayMs) {
    return Date.now() + delayMs;
  }
  if (scheduledAtMs) {
    return scheduledAtMs;
  }
  return 0;
}

function parseDelay(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  let totalMs = 0;
  let index = 0;
  while (index < normalized.length) {
    while (index < normalized.length && /\s/.test(normalized[index])) {
      index += 1;
    }
    if (index >= normalized.length) {
      break;
    }

    const match = normalized.slice(index).match(/^(\d+)\s*([smhd])/);
    if (!match) {
      return 0;
    }

    const amount = Number.parseInt(match[1], 10);
    const unitMs = DELAY_UNIT_MS[match[2]] || 0;
    if (!Number.isFinite(amount) || amount <= 0 || !unitMs) {
      return 0;
    }

    totalMs += amount * unitMs;
    index += match[0].length;
  }

  return totalMs > 0 ? totalMs : 0;
}

function parseAbsoluteTime(rawValue) {
  const normalized = String(rawValue || "").trim();
  if (!normalized) {
    return 0;
  }

  const normalizedIso = normalizeAbsoluteTimeString(normalized);
  const parsed = Date.parse(normalizedIso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAbsoluteTimeString(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  if (/([zZ]|[+-]\d{2}:\d{2})$/.test(normalized)) {
    return normalized.replace(" ", "T");
  }

  const dateTimeMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (dateTimeMatch) {
    return `${dateTimeMatch[1]}T${dateTimeMatch[2]}${LOCAL_TIMEZONE_OFFSET}`;
  }

  const dateOnlyMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}T09:00:00${LOCAL_TIMEZONE_OFFSET}`;
  }

  return normalized;
}

async function resolveBody(options) {
  const inlineText = normalizeBody(options.text);
  if (inlineText) {
    return inlineText;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return normalizeBody(await readStdin());
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

function normalizeBody(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

module.exports = { runReminderWriteCommand };
