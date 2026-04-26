// Translate raw wrapper events emitted by `client-wrapper.js` into the
// canonical `runtime.*` event shape consumed by `core/stream-delivery.js`
// and `core/system-message-dispatcher.js`. Synthetic
// `runtime.turn.started` is emitted directly by `index.js` (after
// `sendUserMessage`) and never appears here.

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function extractDeltaText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.delta === "string") return payload.delta;
  if (payload.delta && typeof payload.delta.text === "string") return payload.delta.text;
  if (typeof payload.text === "string") return payload.text;
  return "";
}

function extractCompleteText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.message === "string") return payload.message;
  if (payload.message && typeof payload.message.text === "string") return payload.message.text;
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

function extractItemId(payload) {
  if (!payload || typeof payload !== "object") return "";
  return normalizeString(payload.messageId || payload.id || (payload.item && payload.item.id));
}

function extractErrorText(event) {
  if (!event || typeof event !== "object") return "";
  if (event.error instanceof Error && event.error.message) return event.error.message;
  if (typeof event.message === "string" && event.message) return event.message;
  if (event.error && typeof event.error.message === "string") return event.error.message;
  if (typeof event.error === "string") return event.error;
  return "copilot runtime error";
}

function mapCopilotMessageToRuntimeEvent(event, context = {}) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const threadId = normalizeString(context.threadId);
  const turnId = normalizeString(context.turnId);

  if (event.type === "assistant.delta") {
    const text = extractDeltaText(event.payload);
    if (!text) return null;
    return {
      type: "runtime.reply.delta",
      payload: {
        threadId,
        turnId,
        itemId: extractItemId(event.payload),
        text,
      },
    };
  }

  if (event.type === "assistant.complete") {
    return {
      type: "runtime.reply.completed",
      payload: {
        threadId,
        turnId,
        itemId: extractItemId(event.payload),
        text: extractCompleteText(event.payload),
      },
    };
  }

  if (event.type === "idle") {
    return {
      type: "runtime.turn.completed",
      payload: {
        threadId,
        turnId,
        text: normalizeString(context.text),
      },
    };
  }

  if (event.type === "error") {
    return {
      type: "runtime.turn.failed",
      payload: {
        threadId,
        turnId,
        text: extractErrorText(event),
      },
    };
  }

  if (event.type === "session.usage_info") {
    const payload = event.payload || {};
    const currentTokens = Number(payload.currentTokens);
    const tokenLimit = Number(payload.tokenLimit);
    if (!Number.isFinite(currentTokens) || !Number.isFinite(tokenLimit) || tokenLimit <= 0) {
      return null;
    }
    return {
      type: "runtime.context.updated",
      payload: {
        threadId,
        runtimeId: "copilot",
        currentTokens,
        contextWindow: tokenLimit,
        model: normalizeString(payload.model),
      },
    };
  }

  return null;
}

module.exports = { mapCopilotMessageToRuntimeEvent };
