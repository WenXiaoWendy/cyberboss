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
        kind: "command",
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

  if (method === "mcpServer/elicitation/request") {
    return mapMcpElicitationToApprovalEvent(message, threadId, turnId, params);
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

function mapMcpElicitationToApprovalEvent(message, threadId, turnId, params) {
  const serverName = normalizeString(params?.serverName);
  const promptMessage = normalizeLineEndings(params?.message);
  const meta = params?._meta && typeof params._meta === "object" ? params._meta : {};
  const approvalKind = normalizeString(meta?.codex_approval_kind);
  const toolName = extractToolNameFromMcpPrompt(promptMessage);
  const commandTokens = toolName
    ? buildApprovalMatchTokens({ toolName: `mcp__${serverName}__${toolName}` })
    : [];
  const command = buildMcpElicitationCommand({
    toolName,
    promptMessage,
    serverName,
    toolParamsDisplay: approvalKind === "mcp_tool_call" ? extractToolParamsDisplay(meta) : [],
  });
  const responseTemplate = approvalKind === "mcp_tool_call"
    ? buildMcpToolCallResponseTemplate()
    : buildUnsupportedMcpElicitationResponseTemplate(params);

  return {
    type: "runtime.approval.requested",
    payload: {
      kind: approvalKind === "mcp_tool_call" ? "mcp_tool_call" : "mcp_elicitation",
      threadId,
      turnId,
      requestId: message?.id ?? null,
      reason: toolName || serverName || "MCP request",
      command,
      commandTokens,
      elicitation: {
        serverName,
        message: promptMessage,
        mode: normalizeString(params?.mode),
        approvalKind,
        toolName,
        toolDescription: normalizeString(meta?.tool_description),
        toolParamsDisplay: extractToolParamsDisplay(meta),
        persistScopes: extractPersistScopes(meta),
        responseTemplate,
      },
      responseTemplate,
    },
  };
}

function buildMcpElicitationCommand({ toolName, promptMessage, serverName, toolParamsDisplay = [] }) {
  const lines = [];
  if (toolName) {
    lines.push(toolName);
  } else if (serverName) {
    lines.push(serverName);
  }

  const detailLines = Array.isArray(toolParamsDisplay) && toolParamsDisplay.length
    ? toolParamsDisplay
      .map((entry) => formatToolParamDisplayLine(entry))
      .filter(Boolean)
    : splitPromptDetailLines(promptMessage);
  if (detailLines.length) {
    lines.push(...detailLines);
  } else if (promptMessage && !toolName) {
    lines.push(promptMessage);
  }

  return lines.join("\n").trim();
}

function splitPromptDetailLines(promptMessage) {
  const normalized = normalizeLineEndings(promptMessage);
  if (!normalized) {
    return [];
  }
  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1);
}

function extractToolNameFromMcpPrompt(promptMessage) {
  const normalized = normalizeLineEndings(promptMessage);
  if (!normalized) {
    return "";
  }
  const quotedMatch = normalized.match(/run tool\s+"([^"]+)"/iu);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }
  const bareMatch = normalized.match(/run tool\s+([a-z0-9_.:-]+)/iu);
  return bareMatch?.[1] ? bareMatch[1].trim() : "";
}

function buildMcpToolCallResponseTemplate() {
  return {
    kind: "mcp_tool_call",
    supportedCommands: ["yes", "no"],
    responseByCommand: {
      yes: { action: "accept" },
      no: { action: "cancel" },
    },
  };
}

function buildUnsupportedMcpElicitationResponseTemplate(params) {
  return {
    kind: "mcp_elicitation",
    mode: normalizeString(params?.mode),
    supportedCommands: [],
    responseByCommand: {},
  };
}

function extractPersistScopes(meta) {
  return Array.isArray(meta?.persist)
    ? meta.persist.map((value) => normalizeString(value)).filter(Boolean)
    : [];
}

function extractToolParamsDisplay(meta) {
  return Array.isArray(meta?.tool_params_display)
    ? meta.tool_params_display
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        name: normalizeString(entry.name),
        displayName: normalizeString(entry.display_name) || normalizeString(entry.name),
        value: entry.value,
      }))
    : [];
}

function formatToolParamDisplayLine(entry) {
  const label = normalizeString(entry?.displayName) || normalizeString(entry?.name);
  if (!label) {
    return "";
  }
  return `${label}: ${formatToolParamValue(entry?.value)}`;
}

function formatToolParamValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLineEndings(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

module.exports = { mapCodexMessageToRuntimeEvent };
