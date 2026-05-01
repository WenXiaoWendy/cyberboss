const crypto = require("crypto");

const SENSITIVE_KEY_RE = /(?:token|secret|password|cookie|authorization|api[_-]?key|private[_-]?key|credential)/i;
const SENSITIVE_VALUE_RE = /\b(?:sk-[a-zA-Z0-9_-]{12,}|Bearer\s+[a-zA-Z0-9_.-]{12,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12);
}

function redactSecret(value) {
  const text = String(value ?? "");
  if (!text) {
    return "";
  }
  return `<redacted-secret hash=${stableHash(text)} length=${text.length}>`;
}

function redactId(value, { unsafeVerbose = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (unsafeVerbose) {
    return text;
  }
  return `<redacted-id hash=${stableHash(text)} length=${text.length}>`;
}

function redactPath(value, { unsafeVerbose = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (unsafeVerbose) {
    return text;
  }
  return `<redacted-path hash=${stableHash(text)}>`;
}

function redactMaybeSensitive(value, key = "") {
  if (value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactMaybeSensitive(item, key));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactMaybeSensitive(entryValue, entryKey),
      ])
    );
  }
  if (typeof value !== "string") {
    return value;
  }
  if (SENSITIVE_KEY_RE.test(key) || SENSITIVE_VALUE_RE.test(value)) {
    return redactSecret(value);
  }
  return value;
}

module.exports = {
  redactId,
  redactMaybeSensitive,
  redactPath,
  redactSecret,
  stableHash,
};
