const SUSPICIOUS_PATTERNS = [
  /\b(?:analysis|commentary|final|summary)\s+to=[a-z0-9_.-]+/i,
  /\bto=functions\.[a-z0-9_]+/i,
  /\bfunctions\.[a-z0-9_]+\b/i,
  /\bas_string\s*=\s*(?:true|false)\b/i,
  /\brecipient_name\b/i,
  /\btool_uses\b/i,
];

function sanitizeProtocolLeakText(text) {
  const normalizedText = normalizeLineEndings(text);
  if (!normalizedText) {
    return {
      text: "",
      changed: false,
    };
  }

  let cutIndex = -1;
  for (const pattern of SUSPICIOUS_PATTERNS) {
    const match = pattern.exec(normalizedText);
    if (!match || typeof match.index !== "number" || match.index < 0) {
      continue;
    }
    if (cutIndex === -1 || match.index < cutIndex) {
      cutIndex = match.index;
    }
  }

  if (cutIndex === -1) {
    return {
      text: normalizedText,
      changed: false,
    };
  }

  const safeCutIndex = findSafeProtocolCutIndex(normalizedText, cutIndex);
  const truncated = normalizedText
    .slice(0, safeCutIndex)
    .replace(/\s+$/g, "")
    .replace(/[|·:：，,；;、\-–—\s]+$/g, "")
    .trim();

  return {
    text: truncated,
    changed: truncated !== normalizedText,
  };
}

function normalizeLineEndings(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function findSafeProtocolCutIndex(text, leakStartIndex) {
  if (!text || leakStartIndex <= 0) {
    return Math.max(0, leakStartIndex);
  }

  const prefix = text.slice(0, leakStartIndex);
  let lastBoundary = -1;
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    const char = prefix[index];
    if (char === "。" || char === "！" || char === "？" || char === "!" || char === "?") {
      lastBoundary = index + 1;
      break;
    }
  }

  if (lastBoundary !== -1) {
    return lastBoundary;
  }
  return leakStartIndex;
}

module.exports = { sanitizeProtocolLeakText };
