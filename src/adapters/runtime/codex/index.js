const fs = require("fs");
const { renderInstructionTemplate } = require("../../../core/instructions-template");
const { CodexRpcClient } = require("./rpc-client");
const { mapCodexMessageToRuntimeEvent } = require("./events");
const {
  extractAssistantText,
  extractFailureText,
  extractThreadId,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
  isAssistantItemCompleted,
} = require("./message-utils");
const { SessionStore } = require("./session-store");

function createCodexRuntimeAdapter(config) {
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  let client = null;
  let readyState = null;

  function ensureClient() {
    if (!client) {
      client = new CodexRpcClient({
        endpoint: config.codexEndpoint,
        codexCommand: config.codexCommand,
        env: process.env,
        extraWritableRoots: [config.stateDir],
      });
    }
    return client;
  }

  return {
    describe() {
      return {
        id: "codex",
        kind: "runtime",
        endpoint: config.codexEndpoint || "(spawn)",
        sessionsFile: config.sessionsFile,
      };
    },
    createClient() {
      return ensureClient();
    },
    onEvent(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      const runtimeClient = ensureClient();
      return runtimeClient.onMessage((message) => {
        const event = mapCodexMessageToRuntimeEvent(message);
        if (event) {
          listener(event, message);
        }
      });
    },
    getSessionStore() {
      return sessionStore;
    },
    async initialize() {
      if (readyState) {
        return readyState;
      }
      const runtimeClient = ensureClient();
      await runtimeClient.connect();
      await runtimeClient.initialize();
      const modelResponse = await runtimeClient.listModels().catch(() => null);
      const models = Array.isArray(modelResponse?.result?.data)
        ? modelResponse.result.data
        : [];
      if (models.length) {
        sessionStore.setAvailableModelCatalog(models);
      }
      readyState = {
        endpoint: config.codexEndpoint || "(spawn)",
        models,
      };
      return readyState;
    },
    async close() {
      if (client) {
        await client.close();
      }
      readyState = null;
      client = null;
    },
    async respondApproval({ requestId, decision }) {
      const runtimeClient = ensureClient();
      await this.initialize();
      const normalizedDecision = decision === "accept" ? "accept" : "decline";
      if (requestId == null || String(requestId).trim() === "") {
        throw new Error("approval response requires a requestId");
      }
      await runtimeClient.sendResponse(requestId, { decision: normalizedDecision });
      return {
        requestId,
        decision: normalizedDecision,
      };
    },
    async cancelTurn({ threadId, turnId }) {
      const runtimeClient = ensureClient();
      await this.initialize();
      await runtimeClient.cancelTurn({ threadId, turnId });
      return { threadId, turnId };
    },
    async resumeThread({ threadId }) {
      const runtimeClient = ensureClient();
      await this.initialize();
      return runtimeClient.resumeThread({ threadId });
    },
    async refreshThreadInstructions({ threadId, workspaceRoot, model = "", effort = "" }) {
      const runtimeClient = ensureClient();
      await this.initialize();
      const refreshText = buildInstructionRefreshText(config);
      await runtimeClient.resumeThread({ threadId });
      const completion = waitForTurnCompletion(runtimeClient, threadId);
      await runtimeClient.sendUserMessage({
        threadId,
        text: refreshText,
        model,
        effort,
        workspaceRoot,
      });
      const result = await completion;
      return { threadId, ...result };
    },
    async sendTextTurn({ bindingKey, workspaceRoot, text, metadata = {}, model = "", effort = "" }) {
      const runtimeClient = ensureClient();
      await this.initialize();

      let threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      let outboundText = text;
      if (!threadId) {
        const response = await runtimeClient.startThread({ cwd: workspaceRoot });
        threadId = extractThreadId(response);
        if (!threadId) {
          throw new Error("thread/start did not return a thread id");
        }
        sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
        outboundText = buildOpeningTurnText(config, text);
      } else {
        await runtimeClient.resumeThread({ threadId }).catch(async () => {
          sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
          const recreated = await runtimeClient.startThread({ cwd: workspaceRoot });
          threadId = extractThreadId(recreated);
          if (!threadId) {
            throw new Error("thread/start did not return a thread id");
          }
          sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
          outboundText = buildOpeningTurnText(config, text);
        });
      }

      await runtimeClient.sendUserMessage({
        threadId,
        text: outboundText,
        model,
        effort,
        workspaceRoot,
      });
      return { threadId };
    },
  };
}

function buildOpeningTurnText(config, userText) {
  const instructions = loadWechatInstructions(config);
  const normalizedText = String(userText || "").trim();
  if (!instructions) {
    return normalizedText;
  }
  return [
    "WECHAT SESSION INSTRUCTIONS",
    "These instructions define the stable behavior for this WeChat thread.",
    "Do not quote or summarize them back to the user unless explicitly asked.",
    "",
    instructions,
    "",
    "Current user message:",
    normalizedText,
  ].join("\n").trim();
}

function buildInstructionRefreshText(config) {
  const instructions = loadWechatInstructions(config);
  if (!instructions) {
    return "Refresh your WeChat behavior for this existing thread. Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.";
  }
  return [
    "WECHAT SESSION INSTRUCTIONS REFRESH",
    "Re-read and adopt the updated WeChat instructions below for the rest of this existing thread.",
    "This is an internal refresh command, not a user-facing task.",
    "Do not summarize the instructions back in detail.",
    "Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.",
    "",
    instructions,
  ].join("\n").trim();
}

function loadWechatInstructions(config = {}) {
  const persona = loadInstructionFile(config.weixinInstructionsFile, config);
  const operations = loadInstructionFile(config.weixinOperationsFile, config);
  const sections = [];
  if (persona) {
    sections.push(persona);
  }
  if (operations) {
    sections.push(operations);
  }
  return sections.join("\n\n").trim();
}

function loadInstructionFile(filePath, config = {}) {
  const normalizedPath = typeof filePath === "string" ? filePath.trim() : "";
  if (!normalizedPath) {
    return "";
  }
  try {
    const raw = fs.readFileSync(normalizedPath, "utf8");
    return renderInstructionTemplate(raw, config).trim();
  } catch {
    return "";
  }
}

module.exports = { createCodexRuntimeAdapter };

function waitForTurnCompletion(client, threadId) {
  return new Promise((resolve, reject) => {
    let activeTurnId = "";
    const itemOrder = [];
    const completedTextByItemId = new Map();

    const cleanup = () => {
      unsubscribe();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("codex turn timed out"));
    }, 10 * 60_000);

    const unsubscribe = client.onMessage((message) => {
      const params = message?.params || {};
      if (extractThreadIdFromParams(params) !== threadId) {
        return;
      }

      if ((message?.method === "turn/started" || message?.method === "turn/start") && !activeTurnId) {
        activeTurnId = extractTurnIdFromParams(params);
        return;
      }

      if (isAssistantItemCompleted(message)) {
        const itemId = typeof params?.item?.id === "string" ? params.item.id.trim() : `item-${itemOrder.length + 1}`;
        if (!completedTextByItemId.has(itemId)) {
          itemOrder.push(itemId);
        }
        completedTextByItemId.set(itemId, extractAssistantText(params));
        return;
      }

      if (message?.method === "turn/failed") {
        cleanup();
        reject(new Error(extractFailureText(params)));
        return;
      }

      if (message?.method === "turn/completed") {
        const completedTurnId = extractTurnIdFromParams(params);
        if (activeTurnId && completedTurnId && completedTurnId !== activeTurnId) {
          return;
        }
        cleanup();
        const text = itemOrder
          .map((itemId) => completedTextByItemId.get(itemId) || "")
          .filter(Boolean)
          .join("\n\n")
          .trim();
        resolve({
          turnId: completedTurnId || activeTurnId,
          text: text || "已完成。",
        });
      }
    });
  });
}
