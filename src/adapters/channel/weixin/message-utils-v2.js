const MESSAGE_TYPE_USER = 1;
const MESSAGE_TYPE_BOT = 2;
const MESSAGE_ITEM_TEXT = 1;
const MESSAGE_ITEM_IMAGE = 2;
const MESSAGE_ITEM_VOICE = 3;
const MESSAGE_ITEM_FILE = 4;
const MESSAGE_ITEM_VIDEO = 5;
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

      const itemList = Array.isArray(message.item_list) ? message.item_list : [];
      const text = bodyFromItemList(itemList);
      const attachments = extractAttachmentItems(itemList);
      if (!text && !attachments.length) {
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
        attachments,
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
      return `[Quoted: ${parts.join(" | ")}]\n${text}`;
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
  return type === MESSAGE_ITEM_IMAGE || type === MESSAGE_ITEM_VOICE || type === MESSAGE_ITEM_FILE || type === MESSAGE_ITEM_VIDEO;
}

function extractAttachmentItems(itemList) {
  if (!Array.isArray(itemList) || !itemList.length) {
    return [];
  }

  const attachments = [];
  for (let index = 0; index < itemList.length; index += 1) {
    const normalized = normalizeAttachmentItem(itemList[index], index);
    if (normalized) {
      attachments.push(normalized);
    }
  }
  return attachments;
}

function normalizeAttachmentItem(item, index) {
  const itemType = Number(item?.type);
  const payload = resolveAttachmentPayload(itemType, item);
  if (!payload) {
    return null;
  }

  const media = payload.media && typeof payload.media === "object"
    ? payload.media
    : {};

  return {
    kind: payload.kind,
    itemType,
    index,
    fileName: normalizeText(
      payload.body?.file_name
      || payload.body?.filename
      || item?.file_name
      || item?.filename
    ),
    sizeBytes: parseOptionalInt(
      payload.body?.len
      || payload.body?.file_size
      || payload.body?.size
      || payload.body?.video_size
      || item?.len
    ),
    directUrls: collectStringValues([
      payload.body?.url,
      payload.body?.download_url,
      payload.body?.cdn_url,
      media?.url,
      media?.download_url,
      media?.cdn_url,
    ]),
    mediaRef: {
      encryptQueryParam: normalizeText(
        media?.encrypt_query_param
        || media?.encrypted_query_param
        || payload.body?.encrypt_query_param
        || payload.body?.encrypted_query_param
        || item?.encrypt_query_param
        || item?.encrypted_query_param
      ),
      aesKey: normalizeText(
        media?.aes_key
        || payload.body?.aes_key
        || item?.aes_key
      ),
      aesKeyHex: normalizeText(
        payload.body?.aeskey
        || payload.body?.aes_key_hex
        || item?.aeskey
      ),
      encryptType: Number(
        media?.encrypt_type
        ?? payload.body?.encrypt_type
        ?? item?.encrypt_type
        ?? 1
      ),
      fileKey: normalizeText(
        media?.filekey
        || payload.body?.filekey
        || item?.filekey
      ),
    },
    rawItem: item,
  };
}

function resolveAttachmentPayload(itemType, item) {
  if (itemType === MESSAGE_ITEM_IMAGE && item?.image_item && typeof item.image_item === "object") {
    return { kind: "image", body: item.image_item, media: item.image_item.media };
  }
  if (itemType === MESSAGE_ITEM_FILE && item?.file_item && typeof item.file_item === "object") {
    return { kind: "file", body: item.file_item, media: item.file_item.media };
  }
  if (itemType === MESSAGE_ITEM_VIDEO && item?.video_item && typeof item.video_item === "object") {
    return { kind: "video", body: item.video_item, media: item.video_item.media };
  }
  return null;
}

function collectStringValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseOptionalInt(value) {
  if (value == null || value === "") {
    return 0;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
