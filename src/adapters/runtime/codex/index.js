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
    async sendTextTurn({ bindingKey, workspaceRoot, text, metadata = {} }) {
      const runtimeClient = ensureClient();
      await this.initialize();

      let threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      if (!threadId) {
        const response = await runtimeClient.startThread({ cwd: workspaceRoot });
        threadId = extractThreadId(response);
        if (!threadId) {
          throw new Error("thread/start did not return a thread id");
        }
        sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
      } else {
        await runtimeClient.resumeThread({ threadId }).catch(async () => {
          sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
          const recreated = await runtimeClient.startThread({ cwd: workspaceRoot });
          threadId = extractThreadId(recreated);
          if (!threadId) {
            throw new Error("thread/start did not return a thread id");
          }
          sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
        });
      }

      const completion = waitForTurnCompletion(runtimeClient, threadId);
      await runtimeClient.sendUserMessage({
        threadId,
        text,
        workspaceRoot,
      });
      const result = await completion;
      return { threadId, ...result };
    },
  };
}

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
        const text = extractAssistantText(params);
        completedTextByItemId.set(itemId, text);
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

module.exports = { createCodexRuntimeAdapter };
