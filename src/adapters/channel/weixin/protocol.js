const crypto = require("crypto");

const DEFAULT_PROTOCOL_CLIENT_VERSION = "2.1.1";
const BOT_API_USER_AGENT = "node";
const ILINK_APP_ID = "bot";

function normalizeRouteTag(routeTag) {
  return typeof routeTag === "string" ? routeTag.trim() : "";
}

function normalizeProtocolClientVersion(version) {
  const normalized = typeof version === "string" ? version.trim() : "";
  return normalized || DEFAULT_PROTOCOL_CLIENT_VERSION;
}

function encodeClientVersion(version) {
  const parts = normalizeProtocolClientVersion(version).split(".");
  const parse = (index) => {
    const value = Number.parseInt(parts[index] || "0", 10);
    return Number.isFinite(value) ? value : 0;
  };
  const major = parse(0);
  const minor = parse(1);
  const patch = parse(2);
  const encoded = ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
  return String(encoded);
}

function buildCommonHeaders({ routeTag = "", clientVersion = DEFAULT_PROTOCOL_CLIENT_VERSION } = {}) {
  const headers = {
    "User-Agent": BOT_API_USER_AGENT,
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": encodeClientVersion(clientVersion),
  };
  const normalizedRouteTag = normalizeRouteTag(routeTag);
  if (normalizedRouteTag) {
    headers.SKRouteTag = normalizedRouteTag;
  }
  return headers;
}

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf8").toString("base64");
}

function buildJsonHeaders({ body, token = "", routeTag = "", clientVersion = DEFAULT_PROTOCOL_CLIENT_VERSION }) {
  const headers = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(String(body || ""), "utf8")),
    "X-WECHAT-UIN": randomWechatUin(),
    ...buildCommonHeaders({ routeTag, clientVersion }),
  };
  const normalizedToken = typeof token === "string" ? token.trim() : "";
  if (normalizedToken) {
    headers.Authorization = `Bearer ${normalizedToken}`;
  }
  return headers;
}

module.exports = {
  DEFAULT_PROTOCOL_CLIENT_VERSION,
  buildCommonHeaders,
  buildJsonHeaders,
  normalizeProtocolClientVersion,
  normalizeRouteTag,
};
