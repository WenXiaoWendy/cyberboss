const {
  extractAssistantText,
  extractFailureText,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
} = require("./message-utils");

function mapCodexMessageToRuntimeEvent(message) {
  if (message?.type === "event_msg" && message?.payload?.type === "token_count") {
    return {
      type: "runtime.usage.updated",
      payload: normalizeUsagePayload(message.payload),
    };
  }
  const method = normalizeString(message?.method);
  const params = message?.params || {};
  const threadId = extractThreadIdFromParams(params);
  const turnId = extractTurnIdFromParams(params);

  if (!method) {
    return null;
  }

  if (method === "turn/started" || method === "turn/start") {
    return {
      type: "runtime.turn.started",
      payload: {
        threadId,
        turnId,
      },
    };
  }

  if (method === "turn/completed") {
    return {
      type: "runtime.turn.completed",
      payload: {
        threadId,
        turnId,
      },
    };
  }

  if (method === "turn/failed") {
    return {
      type: "runtime.turn.failed",
      payload: {
        threadId,
        turnId,
        text: extractFailureText(params),
      },
    };
  }

  if (method === "item/agentMessage/delta") {
    const text = extractAssistantText(params);
    if (!text) {
      return null;
    }
    return {
      type: "runtime.reply.delta",
      payload: {
        threadId,
        turnId,
        itemId: normalizeString(params?.itemId || params?.item?.id),
        text,
      },
    };
  }

  if (method === "item/completed" && normalizeString(params?.item?.type).toLowerCase() === "agentmessage") {
    const text = extractAssistantText(params);
    return {
      type: "runtime.reply.completed",
      payload: {
        threadId,
        turnId,
        itemId: normalizeString(params?.item?.id),
        text,
      },
    };
  }

  if (isApprovalRequestMethod(method)) {
    return {
      type: "runtime.approval.requested",
      payload: {
        threadId,
        requestId: message?.id ?? null,
        reason: normalizeString(params?.reason),
        command: extractApprovalDisplayCommand(params),
        commandTokens: extractApprovalCommandTokens(params),
      },
    };
  }

  return null;
}

function normalizeUsagePayload(payload) {
  const info = payload?.info || {};
  const total = info?.total_token_usage || {};
  const last = info?.last_token_usage || {};
  const rateLimits = payload?.rate_limits || {};
  return {
    totalInputTokens: numberOrZero(total.input_tokens),
    totalCachedInputTokens: numberOrZero(total.cached_input_tokens),
    totalOutputTokens: numberOrZero(total.output_tokens),
    totalReasoningTokens: numberOrZero(total.reasoning_output_tokens),
    totalTokens: numberOrZero(total.total_tokens),
    lastInputTokens: numberOrZero(last.input_tokens),
    lastCachedInputTokens: numberOrZero(last.cached_input_tokens),
    lastOutputTokens: numberOrZero(last.output_tokens),
    lastReasoningTokens: numberOrZero(last.reasoning_output_tokens),
    lastTotalTokens: numberOrZero(last.total_tokens),
    modelContextWindow: numberOrZero(info?.model_context_window),
    primaryUsedPercent: numberOrZero(rateLimits?.primary?.used_percent),
    secondaryUsedPercent: numberOrZero(rateLimits?.secondary?.used_percent),
  };
}

function isApprovalRequestMethod(method) {
  return typeof method === "string" && method.endsWith("requestApproval");
}

function extractApprovalDisplayCommand(params) {
  const commandTokens = extractApprovalCommandTokens(params);
  const direct = params?.command;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  if (Array.isArray(direct)) {
    const normalized = normalizeCommandTokens(direct);
    if (normalized.length) {
      return buildApprovalCommandPreview(normalized);
    }
  }
  return buildApprovalCommandPreview(commandTokens);
}

function extractApprovalCommandTokens(params) {
  return normalizeCommandTokens(extractTokens(params));
}

function extractTokens(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === "string")
      ? value.map((entry) => entry.trim()).filter(Boolean)
      : [];
  }
  if (typeof value === "string") {
    return splitCommandLine(value);
  }
  if (typeof value !== "object") {
    return [];
  }

  for (const key of ["proposedExecpolicyAmendment", "argv", "args", "command", "cmd", "exec", "shellCommand", "script"]) {
    const tokens = extractTokens(value[key]);
    if (tokens.length) {
      return tokens;
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes("execpolicy") || normalizedKey.includes("exec_policy")) {
      const tokens = extractTokens(nested);
      if (tokens.length) {
        return tokens;
      }
    }
  }

  return [];
}

function splitCommandLine(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of String(input || "")) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function buildApprovalCommandPreview(tokens) {
  const normalized = normalizeCommandTokens(tokens);
  if (!normalized.length) {
    return "";
  }
  return normalized.map((token) => (token.includes(" ") ? JSON.stringify(token) : token)).join(" ");
}

function normalizeCommandTokens(tokens) {
  return Array.isArray(tokens)
    ? tokens.map((part) => normalizeString(part)).filter(Boolean)
    : [];
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

module.exports = { mapCodexMessageToRuntimeEvent };
