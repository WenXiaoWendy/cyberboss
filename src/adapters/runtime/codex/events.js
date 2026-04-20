const {
  extractAssistantText,
  extractFailureText,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
} = require("./message-utils");
const {
  extractApprovalCommandTokens: extractSharedApprovalCommandTokens,
  extractApprovalFilePath,
  extractApprovalFilePaths,
  buildApprovalMatchTokens,
  buildApprovalCommandPreview,
  normalizeCommandTokens,
} = require("../shared/approval-command");

function mapCodexMessageToRuntimeEvent(message) {
  if (message?.type === "event_msg" && message?.payload?.type === "token_count") {
    return {
      type: "runtime.context.updated",
      payload: normalizeContextPayload(message),
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
        filePath: extractApprovalFilePath(params),
        filePaths: extractApprovalFilePaths(params),
        commandTokens: buildApprovalMatchTokens({
          commandTokens: extractApprovalCommandTokens(params),
        }),
      },
    };
  }

  return null;
}

function normalizeContextPayload(message) {
  const payload = message?.payload || {};
  const info = payload?.info || {};
  const total = info?.total_token_usage || {};
  return {
    runtimeId: "codex",
    threadId: normalizeString(payload?.thread_id || info?.thread_id),
    inputTokens: numberOrZero(total.input_tokens),
    cachedInputTokens: numberOrZero(total.cached_input_tokens),
    outputTokens: numberOrZero(total.output_tokens),
    reasoningTokens: numberOrZero(total.reasoning_output_tokens),
    currentTokens: numberOrZero(total.total_tokens),
    contextWindow: numberOrZero(info?.model_context_window),
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
  return extractSharedApprovalCommandTokens(params, { scanNestedExecPolicyKeys: true });
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

module.exports = { mapCodexMessageToRuntimeEvent };
