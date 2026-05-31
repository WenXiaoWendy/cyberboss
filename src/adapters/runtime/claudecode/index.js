const path = require("path");
const os = require("os");
const { ClaudeCodeProcessClient } = require("./process-client");
const { mapClaudeCodeMessageToRuntimeEvent } = require("./events");
const { ensureClaudeProjectMcpConfig } = require("./project-settings");
const { SessionStore } = require("../codex/session-store");
const { buildOpeningTurnText, buildInstructionRefreshText } = require("../shared-instructions");
const { ClaudeCodeIpcServer } = require("./ipc-server");
const CLAUDE_RESUME_SESSION_TIMEOUT_MS = 8000;

function createClaudeCodeRuntimeAdapter(config) {
  const sessionStore = new SessionStore({ filePath: config.sessionsFile, runtimeId: "claudecode" });
  const clientsByWorkspace = new Map();
  const pendingApprovals = new Map();
  const configuredModel = normalizeText(config.claudeModel);
  let globalListener = null;
  const IS_WINDOWS = os.platform() === "win32";
  const ipcSocketPath = IS_WINDOWS
    ? "\\\\.\\pipe\\cyberboss-claudecode"
    : path.join(
        config.stateDir || path.join(os.homedir(), ".cyberboss"),
        "claudecode-runtime.sock",
      );
  const ipcServer = new ClaudeCodeIpcServer({ socketPath: ipcSocketPath, stateDir: config.stateDir });

  ipcServer.on("clientMessage", (msg) => {
    if (msg?.type === "sendUserMessage" && msg?.workspaceRoot) {
      const client = clientsByWorkspace.get(msg.workspaceRoot);
      if (client?.alive) {
        client.sendUserMessage({ text: msg.text || "" }).catch(() => {});
      }
    }
    if (msg?.type === "respondApproval" && msg?.workspaceRoot) {
      const client = clientsByWorkspace.get(msg.workspaceRoot);
      if (client?.alive) {
        client.sendResponse(msg.requestId, { decision: msg.decision }).catch(() => {});
      }
    }
  });

  function resolveModel(model = "") {
    return configuredModel || normalizeText(model);
  }

  async function ensureClient(workspaceRoot, model = "") {
    const desiredModel = resolveModel(model);
    const existing = clientsByWorkspace.get(workspaceRoot);
    if (existing) {
      if (normalizeText(existing.model) === desiredModel) {
        return existing;
      }
      await closeWorkspaceClient(workspaceRoot);
    }
    const projectSettings = ensureClaudeProjectMcpConfig({
      workspaceRoot,
      cyberbossHome: process.env.CYBERBOSS_HOME || path.resolve(__dirname, "..", "..", "..", ".."),
    });
    console.log(
      `[claudecode-runtime] workspace=${workspaceRoot} mcp_config=${projectSettings.configPath} server=${projectSettings.serverName}`
    );
    const client = new ClaudeCodeProcessClient({
      command: config.claudeCommand || "claude",
      cwd: workspaceRoot,
      env: filterClaudeCodeEnv(process.env),
      model: desiredModel,
      permissionMode: config.claudePermissionMode || "default",
      disableVerbose: Boolean(config.claudeDisableVerbose),
      extraArgs: config.claudeExtraArgs || [],
      mcpConfigPaths: [projectSettings.configPath],
      ipcServer,
      workspaceRoot,
    });
    client.onMessage((event, raw) => {
      if (event.type === "session.id") {
        for (const binding of sessionStore.listBindings()) {
          if (binding.activeWorkspaceRoot === workspaceRoot) {
            sessionStore.setThreadIdForWorkspace(binding.bindingKey, workspaceRoot, event.sessionId);
          }
        }
        return;
      }
      const mapped = mapClaudeCodeMessageToRuntimeEvent(event, raw);
      if (mapped?.payload && !mapped.payload.workspaceRoot) {
        mapped.payload.workspaceRoot = workspaceRoot;
      }
      if (mapped?.type === "runtime.approval.requested") {
        if (pendingApprovals.size >= 100) {
          const firstKey = pendingApprovals.keys().next().value;
          pendingApprovals.delete(firstKey);
        }
        pendingApprovals.set(mapped.payload.requestId, workspaceRoot);
      }
      if (mapped?.type === "runtime.turn.failed") {
        clientsByWorkspace.delete(workspaceRoot);
      }
      if (mapped && globalListener) {
        globalListener(mapped, raw);
      }
    });
    clientsByWorkspace.set(workspaceRoot, client);
    return client;
  }

  async function attachClientToThread(workspaceRoot, threadId = "", model = "") {
    const normalizedWorkspaceRoot = typeof workspaceRoot === "string" ? workspaceRoot.trim() : "";
    const normalizedThreadId = normalizeThreadId(threadId);
    const desiredModel = resolveModel(model);
    if (!normalizedWorkspaceRoot) {
      throw new Error("workspaceRoot is required");
    }

    const existingClient = clientsByWorkspace.get(normalizedWorkspaceRoot);
    if (existingClient?.alive && normalizeText(existingClient.model) !== desiredModel) {
      await closeWorkspaceClient(normalizedWorkspaceRoot);
    }

    if (normalizedThreadId && clientMatchesThread(existingClient, normalizedThreadId)) {
      return { client: existingClient, threadId: normalizedThreadId };
    }

    if (!normalizedThreadId && existingClient?.alive) {
      await closeWorkspaceClient(normalizedWorkspaceRoot);
    }

    let client = await ensureClient(normalizedWorkspaceRoot, desiredModel);
    if (!client.alive || (normalizedThreadId && !clientMatchesThread(client, normalizedThreadId))) {
      if (client.alive && normalizedThreadId && !clientMatchesThread(client, normalizedThreadId)) {
        await closeWorkspaceClient(normalizedWorkspaceRoot);
        client = await ensureClient(normalizedWorkspaceRoot, desiredModel);
      }
      await client.connect(normalizedThreadId);
    }

    return { client, threadId: normalizedThreadId || normalizeThreadId(client.sessionId) };
  }
  async function closeWorkspaceClient(workspaceRoot) {
    const normalizedWorkspaceRoot = typeof workspaceRoot === "string" ? workspaceRoot.trim() : "";
    if (!normalizedWorkspaceRoot) {
      return;
    }
    const client = clientsByWorkspace.get(normalizedWorkspaceRoot);
    if (!client) {
      return;
    }
    await client.close();
    clientsByWorkspace.delete(normalizedWorkspaceRoot);
    for (const [requestId, candidateWorkspaceRoot] of pendingApprovals.entries()) {
      if (candidateWorkspaceRoot === normalizedWorkspaceRoot) {
        pendingApprovals.delete(requestId);
      }
    }
  }
  return {
    describe() {
      return {
        id: "claudecode",
        kind: "runtime",
        command: config.claudeCommand || "claude",
        sessionsFile: config.sessionsFile,
        ipcSocketPath,
        model: configuredModel,
      };
    },
    onEvent(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      globalListener = listener;
      return () => {
        if (globalListener === listener) {
          globalListener = null;
        }
      };
    },
    getSessionStore() {
      return sessionStore;
    },
    getTurnCapabilities() {
      return {
        nativeImageInput: false,
        toolImageRead: false,
      };
    },
    async initialize() {
      ipcServer.start();
      return {
        command: config.claudeCommand || "claude",
        models: [],
      };
    },
    async close() {
      for (const client of clientsByWorkspace.values()) {
        await client.close();
      }
      clientsByWorkspace.clear();
      await ipcServer.close();
    },
    async startFreshThreadDraft({ workspaceRoot }) {
      await closeWorkspaceClient(workspaceRoot);
      return { workspaceRoot };
    },
    async respondApproval({ requestId, decision, result = null }) {
      const workspaceRoot = pendingApprovals.get(requestId);
      const candidates = workspaceRoot
        ? [clientsByWorkspace.get(workspaceRoot)]
        : [...clientsByWorkspace.values()];
      for (const client of candidates) {
        if (client?.alive) {
          const responsePayload = result && typeof result === "object"
            ? result
            : { decision };
          await client.sendResponse(requestId, responsePayload);
          pendingApprovals.delete(requestId);
          return {
            requestId,
            ...(result && typeof result === "object"
              ? { result: responsePayload }
              : { decision: decision === "accept" ? "accept" : "decline" }),
          };
        }
      }
      throw new Error("no active claudecode session to respond to approval");
    },
    async cancelTurn({ threadId, turnId, workspaceRoot }) {
      if (workspaceRoot) {
        await closeWorkspaceClient(workspaceRoot);
        return { threadId, turnId };
      }
      for (const [workspaceRoot, client] of clientsByWorkspace.entries()) {
        if (client.sessionId === threadId) {
          await client.close();
          clientsByWorkspace.delete(workspaceRoot);
          return { threadId, turnId };
        }
      }
      return { threadId, turnId };
    },
    async resumeThread({ threadId, workspaceRoot, model = "" }) {
      if (!workspaceRoot) {
        return { threadId };
      }
      const attached = await attachClientToThread(workspaceRoot, threadId, model);
      return { threadId: attached.threadId };
    },
    async compactThread({ threadId, workspaceRoot, model = "" }) {
      const { client, threadId: activeThreadId } = await attachClientToThread(workspaceRoot, threadId, model);
      await client.sendUserMessage({ text: "/compact", threadId: activeThreadId });
      return { threadId: activeThreadId, turnId: client.pendingTurnId };
    },
    async refreshThreadInstructions({ threadId, workspaceRoot, model = "" }) {
      const { client, threadId: activeThreadId } = await attachClientToThread(workspaceRoot, threadId, model);
      const refreshText = buildInstructionRefreshText(config);
      await client.sendUserMessage({ text: refreshText, threadId: activeThreadId });
      return { threadId: activeThreadId };
    },
    async sendTextTurn(args) {
      return this.sendTurn(args);
    },
    async sendTurn({ bindingKey, workspaceRoot, text, metadata = {}, model = "" }) {
      const desiredModel = resolveModel(model);
      let threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      if (!threadId) {
        sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
      }
      if (desiredModel) {
        sessionStore.setRuntimeParamsForWorkspace(bindingKey, workspaceRoot, {
          model: desiredModel,
          modelProvider: "",
        });
      }
      let openingTurn = !threadId;
      let attached;
      try {
        attached = await attachClientToThread(workspaceRoot, threadId, desiredModel);
      } catch (error) {
        if (!threadId) {
          throw error;
        }
        sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
        threadId = "";
        openingTurn = true;
        attached = await attachClientToThread(workspaceRoot, "", desiredModel);
      }
      const { client, threadId: activeThreadId } = attached;
      const outboundText = openingTurn ? buildOpeningTurnText(config, text) : text;
      const outboundThreadId = activeThreadId || threadId;
      if (outboundThreadId) {
        sessionStore.setThreadIdForWorkspace(
          bindingKey,
          workspaceRoot,
          outboundThreadId,
          metadata,
        );
      }
      await client.sendUserMessage({ text: outboundText, threadId: outboundThreadId });
      const returnedThreadId = outboundThreadId || normalizeThreadId(
        await client.waitForSessionId({ timeoutMs: CLAUDE_RESUME_SESSION_TIMEOUT_MS })
      );
      if (!returnedThreadId) {
        throw new Error("claudecode did not report a session id");
      }
      sessionStore.setThreadIdForWorkspace(
        bindingKey,
        workspaceRoot,
        returnedThreadId,
        metadata,
      );
      return {
        threadId: returnedThreadId,
        turnId: client.pendingTurnId,
      };
    },
  };
}

function filterClaudeCodeEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (key !== "CLAUDECODE") {
      out[key] = value;
    }
  }
  return out;
}

module.exports = { createClaudeCodeRuntimeAdapter };

function normalizeThreadId(value) {
  return typeof value === "string" ? value.replace(/\s+/g, "").trim() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clientMatchesThread(client, threadId) {
  const normalizedThreadId = normalizeThreadId(threadId);
  if (!normalizedThreadId || !client?.alive) {
    return false;
  }
  return normalizeThreadId(client.sessionId) === normalizedThreadId
    || normalizeThreadId(client.resumeSessionId) === normalizedThreadId;
}
