const fs = require("fs");
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
  const pendingModelByWorkspaceRoot = new Map();
  const configuredModel = normalizeText(config.claudeModel);
  let globalListener = null;
  const ipcSocketPath = path.join(
    config.stateDir || path.join(os.homedir(), ".cyberboss"),
    "claudecode-runtime.sock",
  );
  const ipcServer = new ClaudeCodeIpcServer({ socketPath: ipcSocketPath });

  hydrateRuntimeModelsFromClaudeProjects();

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

  function resolveModel() {
    return configuredModel || readClaudeEnvModel({
      claudeConfigDir: config.claudeConfigDir,
      env: process.env,
    });
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
      rememberObservedModelForWorkspace(workspaceRoot);
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
        model: resolveModel(),
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
    getTurnCapabilities({ model = "" } = {}) {
      const effectiveModel = resolveModel() || normalizeText(model);
      return {
        nativeImageInput: false,
        toolImageRead: hasClaudeImageFileRead(effectiveModel),
      };
    },
    async initialize() {
      hydrateRuntimeModelsFromClaudeProjects();
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
      rememberModelForBinding(
        bindingKey,
        workspaceRoot,
        desiredModel || pendingModelByWorkspaceRoot.get(normalizeText(workspaceRoot)),
      );
      return {
        threadId: returnedThreadId,
        turnId: client.pendingTurnId,
      };
    },
  };

  function hydrateRuntimeModelsFromClaudeProjects() {
    const desiredModel = resolveModel();
    for (const binding of sessionStore.listBindings()) {
      const workspaceRoots = new Set([
        normalizeText(binding.activeWorkspaceRoot),
        ...sessionStore.listWorkspaceRoots(binding.bindingKey),
      ].filter(Boolean));
      for (const workspaceRoot of workspaceRoots) {
        if (desiredModel) {
          rememberModelForBinding(binding.bindingKey, workspaceRoot, desiredModel);
        }
      }
    }
  }

  function rememberObservedModelForWorkspace(workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    const normalizedModel = resolveModel();
    if (!normalizedWorkspaceRoot || !normalizedModel) {
      return;
    }
    let remembered = false;
    for (const binding of sessionStore.listBindings()) {
      if (normalizeText(binding.activeWorkspaceRoot) === normalizedWorkspaceRoot) {
        rememberModelForBinding(binding.bindingKey, normalizedWorkspaceRoot, normalizedModel);
        remembered = true;
      }
    }
    if (!remembered) {
      pendingModelByWorkspaceRoot.set(normalizedWorkspaceRoot, normalizedModel);
    }
  }

  function rememberModelForBinding(bindingKey, workspaceRoot, model) {
    const normalizedModel = normalizeText(model);
    if (!bindingKey || !normalizeText(workspaceRoot) || !normalizedModel) {
      return;
    }
    const current = sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
    if (normalizeText(current.model) === normalizedModel) {
      return;
    }
    sessionStore.setRuntimeParamsForWorkspace(bindingKey, workspaceRoot, {
      model: normalizedModel,
      modelProvider: "",
    });
  }
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

function readClaudeEnvModel({ claudeConfigDir = "", env = {} } = {}) {
  const envModel = normalizeText(env?.ANTHROPIC_MODEL);
  if (envModel) {
    return envModel;
  }
  const baseDir = normalizeText(claudeConfigDir) || path.join(os.homedir(), ".claude");
  const settingsPath = path.join(baseDir, "settings.json");
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const settingsEnv = settings && typeof settings.env === "object" && settings.env
      ? settings.env
      : {};
    const settingsEnvModel = normalizeText(settingsEnv.ANTHROPIC_MODEL);
    if (settingsEnvModel) {
      return settingsEnvModel;
    }
    return resolveClaudeSettingsModel(settings?.model, { ...env, ...settingsEnv });
  } catch {
    return "";
  }
}

function resolveClaudeSettingsModel(model, env = {}) {
  const selectedModel = normalizeText(model);
  if (!selectedModel) {
    return "";
  }
  const alias = getClaudeModelAlias(selectedModel);
  if (!alias) {
    return selectedModel;
  }
  const defaultModel = readClaudeDefaultModelForAlias(alias, env);
  return defaultModel || selectedModel;
}

function getClaudeModelAlias(model) {
  const normalized = normalizeText(model).toLowerCase();
  if (!normalized || normalized === "default") {
    return "";
  }
  const base = normalized.replace(/\[.*$/, "");
  if (base === "opusplan") {
    return "opus";
  }
  if (base === "sonnet" || base === "opus" || base === "haiku" || base === "fable") {
    return base;
  }
  return "";
}

function readClaudeDefaultModelForAlias(alias, env) {
  const upperAlias = alias.toUpperCase();
  return normalizeText(env?.[`ANTHROPIC_DEFAULT_${upperAlias}_MODEL`])
    || normalizeText(env?.[`ANTHROPIC_DEFAULT_${upperAlias}_MODEL_NAME`]);
}

function hasClaudeImageFileRead(model) {
  const normalized = normalizeText(model).toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized === "sonnet"
    || normalized === "opus"
    || normalized === "haiku"
    || /\b(?:sonnet|opus|haiku)\b/.test(normalized)
    || /^claude-(?:3|4)(?:\b|-)/.test(normalized);
}

function clientMatchesThread(client, threadId) {
  const normalizedThreadId = normalizeThreadId(threadId);
  if (!normalizedThreadId || !client?.alive) {
    return false;
  }
  return normalizeThreadId(client.sessionId) === normalizedThreadId
    || normalizeThreadId(client.resumeSessionId) === normalizedThreadId;
}
