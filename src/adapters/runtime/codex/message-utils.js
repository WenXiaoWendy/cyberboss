function extractThreadId(response) {
  return response?.result?.thread?.id || null;
}

function extractThreadIdFromParams(params) {
  return normalizeIdentifier(params?.threadId);
}

function extractTurnIdFromParams(params) {
  return normalizeIdentifier(params?.turnId || params?.turn?.id);
}

function isAssistantItemCompleted(message) {
  return message?.method === "item/completed"
    && normalizeIdentifier(message?.params?.item?.type).toLowerCase() === "agentmessage";
}

function extractAssistantText(params) {
  const directText = [params?.delta, params?.item?.text];
  for (const value of directText) {
    if (typeof value === "string" && value.length > 0) {
      return normalizeLineEndings(value);
    }
  }

  const content = params?.item?.content || params?.content;
  if (Array.isArray(content)) {
    const parts = content
      .map((entry) => {
        if (typeof entry?.text === "string" && entry.text.trim()) {
          return entry.text;
        }
        if (typeof entry?.value === "string" && entry.value.trim()) {
          return entry.value;
        }
        return "";
      })
      .filter(Boolean);
    if (parts.length) {
      return normalizeLineEndings(parts.join("\n"));
    }
  }

  return "";
}

function extractFailureText(params) {
  const rawMessage = normalizeIdentifier(params?.turn?.error?.message || params?.error?.message);
  return rawMessage ? `执行失败：${rawMessage}` : "执行失败";
}

function normalizeIdentifier(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLineEndings(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

module.exports = {
  extractAssistantText,
  extractFailureText,
  extractThreadId,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
  isAssistantItemCompleted,
};
