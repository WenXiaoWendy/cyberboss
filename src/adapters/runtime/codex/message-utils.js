function extractThreadId(response) {
  return response?.result?.thread?.id || null;
}

function extractTurnId(response) {
  return normalizeIdentifier(
    response?.result?.turn?.id
    || response?.result?.turnId
    || response?.result?.turn_id
    || response?.result?.id
  );
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
  const directText = [
    params?.delta,
    params?.item?.text,
  ];
  for (const value of directText) {
    if (typeof value === "string" && value.length > 0) {
      return normalizeLineEndings(value);
    }
  }

  const contentObjects = [
    params?.item?.content,
    params?.content,
  ];
  for (const content of contentObjects) {
    const extracted = extractRawTextFromContent(content);
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

function extractFailureText(params) {
  const rawMessage = normalizeIdentifier(params?.turn?.error?.message || params?.error?.message);
  return rawMessage ? `Execution failed: ${rawMessage}` : "Execution failed";
}

function normalizeIdentifier(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLineEndings(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function extractRawTextFromContent(content) {
  if (typeof content === "string" && content.length > 0) {
    return normalizeLineEndings(content);
  }

  if (!content) {
    return "";
  }

  if (Array.isArray(content)) {
    const parts = [];
    for (const entry of content) {
      if (typeof entry === "string" && entry.length > 0) {
        parts.push(normalizeLineEndings(entry));
        continue;
      }
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const entryType = String(entry.type || "").toLowerCase();
      if (entryType === "text" && typeof entry.text === "string" && entry.text.length > 0) {
        parts.push(normalizeLineEndings(entry.text));
        continue;
      }
      if (typeof entry.text === "string" && entry.text.length > 0) {
        parts.push(normalizeLineEndings(entry.text));
        continue;
      }
      if (typeof entry.value === "string" && entry.value.length > 0) {
        parts.push(normalizeLineEndings(entry.value));
      }
    }
    return parts.join("");
  }

  if (typeof content !== "object") {
    return "";
  }

  if (typeof content.text === "string" && content.text.length > 0) {
    return normalizeLineEndings(content.text);
  }

  return "";
}

module.exports = {
  extractAssistantText,
  extractFailureText,
  extractThreadId,
  extractTurnId,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
  isAssistantItemCompleted,
};
