const {
  extractAssistantText,
  extractFailureText,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
} = require("./message-utils");

function mapCodexMessageToRuntimeEvent(message) {
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
        requestId: message?.id != null ? String(message.id) : "",
        reason: normalizeString(params?.reason),
        command: extractApprovalDisplayCommand(params),
      },
    };
  }

  return null;
}

function isApprovalRequestMethod(method) {
  return typeof method === "string" && method.endsWith("requestApproval");
}

function extractApprovalDisplayCommand(params) {
  const direct = normalizeString(params?.command);
  if (direct) {
    return direct;
  }
  const argv = Array.isArray(params?.argv) ? params.argv.filter((part) => typeof part === "string" && part.trim()) : [];
  if (argv.length) {
    return argv.join(" ");
  }
  return "";
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { mapCodexMessageToRuntimeEvent };
