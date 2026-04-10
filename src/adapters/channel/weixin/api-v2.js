const crypto = require("crypto");
const { buildJsonHeaders } = require("./protocol");

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY_BYTES = 64 << 20;
const CHANNEL_VERSION = "cyberboss-weixin/2.0";

function buildBaseInfo() {
  return { channel_version: CHANNEL_VERSION };
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

async function apiPost({
  baseUrl,
  endpoint,
  token,
  body,
  timeoutMs = 0,
  label,
  routeTag = "",
  clientVersion = "",
}) {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl)).toString();
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? timeoutMs : DEFAULT_API_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout + 5_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildJsonHeaders({ body, token, routeTag, clientVersion }),
      body,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BODY_BYTES) {
      throw new Error(`${label} response body exceeds ${MAX_RESPONSE_BODY_BYTES} bytes`);
    }
    if (!response.ok) {
      throw new Error(`${label} http ${response.status}: ${truncateForLog(raw, 512)}`);
    }
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${truncateForLog(raw, 256)}`);
  }
}

function assertApiSuccess(parsed, label) {
  const ret = parsed?.ret;
  const errcode = parsed?.errcode;
  if ((ret !== undefined && ret !== 0) || (errcode !== undefined && errcode !== 0)) {
    throw new Error(`${label} ret=${ret ?? ""} errcode=${errcode ?? ""} errmsg=${parsed?.errmsg ?? ""}`);
  }
  return parsed;
}

function truncateForLog(value, max) {
  const text = typeof value === "string" ? value : String(value || "");
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function getUpdatesV2({
  baseUrl,
  token,
  getUpdatesBuf = "",
  timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS,
  routeTag = "",
  clientVersion = "",
}) {
  const payload = JSON.stringify({
    get_updates_buf: getUpdatesBuf,
    base_info: buildBaseInfo(),
  });
  try {
    const raw = await apiPost({
      baseUrl,
      endpoint: "ilink/bot/getupdates",
      token,
      body: payload,
      timeoutMs,
      label: "getUpdates",
      routeTag,
      clientVersion,
    });
    return parseJson(raw, "getUpdates");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
    }
    if (String(error?.message || "").includes("aborted")) {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
    }
    throw error;
  }
}

async function sendTextV2({
  baseUrl,
  token,
  toUserId,
  text,
  contextToken,
  clientId,
  routeTag = "",
  clientVersion = "",
}) {
  if (!String(contextToken || "").trim()) {
    throw new Error("weixin-v2 sendText requires contextToken");
  }
  const itemList = [];
  if (String(text || "").trim()) {
    itemList.push({
      type: 1,
      text_item: { text: String(text) },
    });
  }
  if (!itemList.length) {
    throw new Error("weixin-v2 sendText requires non-empty text");
  }
  return sendMessageV2({
    baseUrl,
    token,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: clientId || `cb-${crypto.randomUUID()}`,
        message_type: 2,
        message_state: 2,
        item_list: itemList,
        context_token: contextToken,
      },
    },
    routeTag,
    clientVersion,
  });
}

async function sendMessageV2({
  baseUrl,
  token,
  body,
  routeTag = "",
  clientVersion = "",
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
}) {
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/sendmessage",
    token,
    body: JSON.stringify({
      ...body,
      base_info: buildBaseInfo(),
    }),
    timeoutMs,
    label: "sendMessage",
    routeTag,
    clientVersion,
  });
  return assertApiSuccess(parseJson(raw, "sendMessage"), "sendMessage");
}

async function getConfigV2({
  baseUrl,
  token,
  ilinkUserId,
  contextToken,
  routeTag = "",
  clientVersion = "",
  timeoutMs = DEFAULT_CONFIG_TIMEOUT_MS,
}) {
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/getconfig",
    token,
    body: JSON.stringify({
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: buildBaseInfo(),
    }),
    timeoutMs,
    label: "getConfig",
    routeTag,
    clientVersion,
  });
  return assertApiSuccess(parseJson(raw, "getConfig"), "getConfig");
}

async function sendTypingV2({
  baseUrl,
  token,
  body,
  routeTag = "",
  clientVersion = "",
  timeoutMs = DEFAULT_CONFIG_TIMEOUT_MS,
}) {
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/sendtyping",
    token,
    body: JSON.stringify({
      ...body,
      base_info: buildBaseInfo(),
    }),
    timeoutMs,
    label: "sendTyping",
    routeTag,
    clientVersion,
  });
  return assertApiSuccess(parseJson(raw, "sendTyping"), "sendTyping");
}

async function getUploadUrlV2({
  baseUrl,
  token,
  routeTag = "",
  clientVersion = "",
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
  ...payload
}) {
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    token,
    body: JSON.stringify({
      ...payload,
      base_info: buildBaseInfo(),
    }),
    timeoutMs,
    label: "getUploadUrl",
    routeTag,
    clientVersion,
  });
  return assertApiSuccess(parseJson(raw, "getUploadUrl"), "getUploadUrl");
}

module.exports = {
  getConfigV2,
  getUpdatesV2,
  getUploadUrlV2,
  sendMessageV2,
  sendTypingV2,
  sendTextV2,
};
