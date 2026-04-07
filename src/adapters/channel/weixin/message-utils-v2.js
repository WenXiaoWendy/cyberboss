const MESSAGE_TYPE_USER = 1;
const MESSAGE_TYPE_BOT = 2;
const MESSAGE_ITEM_TEXT = 1;
const MESSAGE_ITEM_VOICE = 3;
const DEDUP_TTL_MS = 5 * 60_000;

function createInboundFilter() {
  const seen = new Map();

  return {
    normalize(message, config, accountId) {
      if (!message || typeof message !== "object") {
        return null;
      }
      const messageType = Number(message.message_type);
      if (messageType === MESSAGE_TYPE_BOT) {
        return null;
      }
      if (messageType !== 0 && messageType !== MESSAGE_TYPE_USER) {
        return null;
      }

      const senderId = normalizeText(message.from_user_id);
      if (!senderId) {
        return null;
      }

      const createdAtMs = normalizeMessageTimestampMs(message);

      const dedupKey = buildDedupKey(message, senderId, createdAtMs);
      pruneSeen(seen);
      if (dedupKey && seen.has(dedupKey)) {
        return null;
      }
      if (dedupKey) {
        seen.set(dedupKey, Date.now());
      }

      const text = bodyFromItemList(Array.isArray(message.item_list) ? message.item_list : []);
      if (!text) {
        return null;
      }

      return {
        provider: "weixin",
        accountId,
        workspaceId: config.workspaceId,
        senderId,
        chatId: senderId,
        messageId: normalizeMessageId(message),
        threadKey: normalizeText(message.session_id),
        text,
        contextToken: normalizeText(message.context_token),
        receivedAt: createdAtMs > 0 ? new Date(createdAtMs).toISOString() : new Date().toISOString(),
      };
    },
  };
}

function bodyFromItemList(items) {
  if (!Array.isArray(items) || !items.length) {
    return "";
  }
  for (const item of items) {
    const itemType = Number(item?.type);
    if (itemType === MESSAGE_ITEM_TEXT) {
      const text = normalizeText(item?.text_item?.text);
      if (!text) {
        continue;
      }
      const ref = item?.ref_msg;
      if (!ref || !ref.message_item || isMediaItemType(Number(ref.message_item.type))) {
        return text;
      }
      const parts = [];
      const refTitle = normalizeText(ref.title);
      if (refTitle) {
        parts.push(refTitle);
      }
      const refBody = bodyFromItemList([ref.message_item]);
      if (refBody) {
        parts.push(refBody);
      }
      if (!parts.length) {
        return text;
      }
      return `[引用: ${parts.join(" | ")}]\n${text}`;
    }
    if (itemType === MESSAGE_ITEM_VOICE) {
      const voiceText = normalizeText(item?.voice_item?.text);
      if (voiceText) {
        return voiceText;
      }
    }
  }
  return "";
}

function isMediaItemType(type) {
  return type === 2 || type === 3 || type === 4 || type === 5;
}

function normalizeMessageId(message) {
  const raw = message?.message_id;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === "string") {
    return raw.trim();
  }
  return "";
}

function normalizeMessageTimestampMs(message) {
  const rawMs = Number(message?.create_time_ms);
  if (Number.isFinite(rawMs) && rawMs > 0) {
    return rawMs;
  }
  const rawSeconds = Number(message?.create_time);
  if (Number.isFinite(rawSeconds) && rawSeconds > 0) {
    return rawSeconds * 1000;
  }
  return 0;
}

function buildDedupKey(message, senderId, createdAtMs) {
  const seq = normalizeNumeric(message?.seq);
  const messageId = normalizeNumeric(message?.message_id);
  const clientId = normalizeText(message?.client_id);
  const parts = [senderId, messageId, seq, createdAtMs || 0, clientId];
  return parts.join("|");
}

function normalizeNumeric(value) {
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : "0";
}

function pruneSeen(seen) {
  const now = Date.now();
  for (const [key, timestamp] of seen.entries()) {
    if (now - timestamp > DEDUP_TTL_MS) {
      seen.delete(key);
    }
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  createInboundFilter,
  bodyFromItemList,
};
