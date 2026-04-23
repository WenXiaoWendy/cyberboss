const crypto = require("crypto");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { loadPersistedContextTokens } = require("../adapters/channel/weixin/context-token-store");
const { ReminderQueueStore } = require("../adapters/channel/weixin/reminder-queue-store");
const { resolvePreferredSenderId } = require("../core/default-targets");
const { resolveBodyInput } = require("./text-input");

const DELAY_UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
};
const LOCAL_TIMEZONE_OFFSET = "+08:00";

class ReminderService {
  constructor({ config, sessionStore }) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.queue = new ReminderQueueStore({ filePath: config.reminderQueueFile });
  }

  async create({
    delay = "",
    delayMinutes = undefined,
    at = "",
    dueAt = "",
    text = "",
    textFile = "",
    userId = "",
  } = {}, context = {}) {
    const body = await resolveBodyInput({ text, textFile });
    if (!body) {
      throw new Error("Reminder text cannot be empty. Pass text or textFile.");
    }

    const dueAtMs = resolveDueAtMs({ delay, delayMinutes, at, dueAt });
    if (!Number.isFinite(dueAtMs) || dueAtMs <= Date.now()) {
      throw new Error("Missing a valid time. Use delayMinutes or dueAt like 2026-04-07T21:30+08:00.");
    }

    const account = resolveSelectedAccount(this.config);
    const senderId = resolveReminderSenderId({
      config: this.config,
      accountId: account.accountId,
      explicitUser: userId,
      context,
      sessionStore: this.sessionStore,
    });
    if (!senderId) {
      throw new Error("Cannot determine the WeChat user for this reminder.");
    }

    const contextTokens = loadPersistedContextTokens(this.config, account.accountId);
    const contextToken = String(contextTokens[senderId] || "").trim();
    if (!contextToken) {
      throw new Error(`Cannot find context_token for ${senderId}. Let this user talk to the bot once first.`);
    }

    const reminder = this.queue.enqueue({
      id: crypto.randomUUID(),
      accountId: account.accountId,
      senderId,
      contextToken,
      text: body,
      dueAtMs,
      createdAt: new Date().toISOString(),
    });
    return reminder;
  }
}

function resolveReminderSenderId({ config, accountId, explicitUser = "", context = {}, sessionStore = null }) {
  const explicit = normalizeText(explicitUser);
  if (explicit) {
    return explicit;
  }
  const contextual = normalizeText(context?.senderId);
  if (contextual) {
    return contextual;
  }
  return resolvePreferredSenderId({
    config,
    accountId,
    sessionStore,
  });
}

function resolveDueAtMs({ delay = "", delayMinutes = undefined, at = "", dueAt = "" } = {}) {
  const delayMs = parseDelay(delay);
  const normalizedDelayMinutes = parseDelayMinutes(delayMinutes);
  const scheduledAtMs = parseAbsoluteTime(dueAt || at);
  const timeSourceCount = [delayMs, normalizedDelayMinutes, scheduledAtMs].filter((value) => value > 0).length;
  if (timeSourceCount > 1) {
    throw new Error("Use only one of delay, delayMinutes, at, or dueAt.");
  }
  if (delayMs) {
    return Date.now() + delayMs;
  }
  if (normalizedDelayMinutes) {
    return Date.now() + normalizedDelayMinutes;
  }
  if (scheduledAtMs) {
    return scheduledAtMs;
  }
  return 0;
}

function parseDelayMinutes(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return 0;
  }
  const parsed = Number.parseInt(String(rawValue), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 60_000 : 0;
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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  ReminderService,
  parseAbsoluteTime,
  parseDelay,
  parseDelayMinutes,
  resolveDueAtMs,
};
