const { spawn } = require("child_process");
const os = require("os");
const WebSocket = require("ws");

const IS_WINDOWS = os.platform() === "win32";
const DEFAULT_CODEX_COMMAND = "codex";
const WINDOWS_EXECUTABLE_SUFFIX_RE = /\.(cmd|exe|bat)$/i;
const CODEX_CLIENT_INFO = {
  name: "cyberboss_agent",
  title: "Cyberboss Agent",
  version: "0.1.0",
};

class CodexRpcClient {
  constructor({ endpoint = "", env = process.env, codexCommand = "" }) {
    this.endpoint = endpoint;
    this.env = env;
    this.codexCommand = codexCommand || resolveDefaultCodexCommand(env);
    this.mode = endpoint ? "websocket" : "spawn";
    this.socket = null;
    this.child = null;
    this.stdoutBuffer = "";
    this.pending = new Map();
    this.isReady = false;
    this.messageListeners = new Set();
  }

  async connect() {
    if (this.mode === "websocket") {
      await this.connectWebSocket();
      return;
    }
    await this.connectSpawn();
  }

  async connectSpawn() {
    const commandCandidates = buildCodexCommandCandidates(this.codexCommand);
    let child = null;
    let lastError = null;

    for (const command of commandCandidates) {
      try {
        const spawnSpec = buildSpawnSpec(command);
        child = spawn(spawnSpec.command, spawnSpec.args, {
          env: { ...this.env },
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });
        break;
      } catch (error) {
        lastError = error;
        if (error?.code !== "ENOENT" && error?.code !== "EINVAL") {
          throw error;
        }
      }
    }

    if (!child) {
      const attempted = commandCandidates.join(", ");
      const detail = lastError?.message ? `: ${lastError.message}` : "";
      throw new Error(`Unable to spawn Codex app-server. Tried ${attempted}${detail}.`);
    }

    this.child = child;
    child.on("error", () => {
      this.isReady = false;
    });
    child.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk.toString("utf8");
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          this.handleIncoming(trimmed);
        }
      }
    });
    child.on("close", () => {
      this.isReady = false;
    });
  }

  async connectWebSocket() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.endpoint);
      this.socket = socket;
      socket.on("open", () => resolve());
      socket.on("error", (error) => reject(error));
      socket.on("message", (chunk) => {
        const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (message.trim()) {
          this.handleIncoming(message);
        }
      });
      socket.on("close", () => {
        this.isReady = false;
      });
    });
  }

  onMessage(listener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  async initialize() {
    if (this.isReady) {
      return;
    }
    await this.sendRequest("initialize", {
      clientInfo: CODEX_CLIENT_INFO,
      capabilities: {
        experimentalApi: true,
      },
    });
    await this.sendNotification("initialized", null);
    this.isReady = true;
  }

  async sendUserMessage({ threadId, text, model = null, effort = null, accessMode = null, workspaceRoot = "" }) {
    const input = buildTurnInputPayload(text);
    return threadId
      ? this.sendRequest("turn/start", buildTurnStartParams({
        threadId,
        input,
        model,
        effort,
        accessMode,
        workspaceRoot,
      }))
      : this.sendRequest("thread/start", { input });
  }

  async startThread({ cwd }) {
    return this.sendRequest("thread/start", buildStartThreadParams(cwd));
  }

  async resumeThread({ threadId }) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("thread/resume requires a non-empty threadId");
    }
    return this.sendRequest("thread/resume", { threadId: normalizedThreadId });
  }

  async listThreads({ cursor = null, limit = 100, sortKey = "updated_at" } = {}) {
    return this.sendRequest("thread/list", buildListThreadsParams({
      cursor,
      limit,
      sortKey,
    }));
  }

  async listModels() {
    return this.sendRequest("model/list", {});
  }

  async close() {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // best effort
      }
      this.socket = null;
    }
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        // best effort
      }
      this.child = null;
    }
    this.isReady = false;
  }

  async sendRequest(method, params) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify({ id, method, params });
    const responsePromise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.sendRaw(payload);
    return responsePromise;
  }

  async sendNotification(method, params) {
    this.sendRaw(JSON.stringify({ method, params }));
  }

  async sendResponse(id, result) {
    if (id == null || id === "") {
      throw new Error("Codex RPC response requires a non-empty id");
    }
    this.sendRaw(JSON.stringify({ id, result }));
  }

  sendRaw(payload) {
    if (this.mode === "websocket") {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        throw new Error("Codex websocket is not connected");
      }
      this.socket.send(payload);
      return;
    }
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Codex process stdin is not writable");
    }
    this.child.stdin.write(`${payload}\n`);
  }

  handleIncoming(rawMessage) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return;
    }

    if (parsed && parsed.id != null && this.pending.has(String(parsed.id))) {
      const { resolve, reject } = this.pending.get(String(parsed.id));
      this.pending.delete(String(parsed.id));
      if (parsed.error) {
        reject(new Error(parsed.error.message || "Codex RPC request failed"));
        return;
      }
      resolve(parsed);
      return;
    }

    for (const listener of this.messageListeners) {
      listener(parsed);
    }
  }
}

function resolveDefaultCodexCommand(env = process.env) {
  return normalizeNonEmptyString(env.CYBERBOSS_CODEX_COMMAND) || DEFAULT_CODEX_COMMAND;
}

function buildCodexCommandCandidates(configuredCommand) {
  const explicit = normalizeNonEmptyString(configuredCommand);
  if (explicit) {
    if (!IS_WINDOWS) {
      return [explicit];
    }
    const candidates = [explicit];
    if (!WINDOWS_EXECUTABLE_SUFFIX_RE.test(explicit)) {
      candidates.push(`${explicit}.cmd`, `${explicit}.exe`, `${explicit}.bat`);
    }
    return [...new Set(candidates)];
  }
  if (IS_WINDOWS) {
    return [DEFAULT_CODEX_COMMAND, `${DEFAULT_CODEX_COMMAND}.cmd`, `${DEFAULT_CODEX_COMMAND}.exe`, `${DEFAULT_CODEX_COMMAND}.bat`];
  }
  return [DEFAULT_CODEX_COMMAND];
}

function buildSpawnSpec(command) {
  if (IS_WINDOWS) {
    return {
      command: "cmd.exe",
      args: ["/c", command, "app-server"],
    };
  }
  return {
    command,
    args: ["app-server"],
  };
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function buildStartThreadParams(cwd) {
  const normalizedCwd = normalizeNonEmptyString(cwd);
  return normalizedCwd ? { cwd: normalizedCwd } : {};
}

function buildListThreadsParams({ cursor, limit, sortKey }) {
  const params = { limit, sortKey };
  const normalizedCursor = normalizeNonEmptyString(cursor);
  if (normalizedCursor) {
    params.cursor = normalizedCursor;
  } else if (cursor != null) {
    params.cursor = cursor;
  }
  return params;
}

function buildTurnInputPayload(text) {
  const normalizedText = normalizeNonEmptyString(text);
  return normalizedText ? [{ type: "text", text: normalizedText }] : [];
}

function buildTurnStartParams({ threadId, input, model, effort, accessMode, workspaceRoot }) {
  const params = { threadId, input };
  const normalizedWorkspaceRoot = normalizeNonEmptyString(workspaceRoot);
  const normalizedModel = normalizeNonEmptyString(model);
  const normalizedEffort = normalizeNonEmptyString(effort);
  const normalizedAccessMode = normalizeAccessMode(accessMode);
  const executionPolicies = buildExecutionPolicies(normalizedAccessMode, workspaceRoot);
  if (normalizedWorkspaceRoot) {
    params.cwd = normalizedWorkspaceRoot;
  }
  if (normalizedModel) {
    params.model = normalizedModel;
  }
  if (normalizedEffort) {
    params.effort = normalizedEffort;
  }
  if (normalizedAccessMode) {
    params.accessMode = normalizedAccessMode;
  }
  params.approvalPolicy = executionPolicies.approvalPolicy;
  params.sandboxPolicy = executionPolicies.sandboxPolicy;
  return params;
}

function normalizeAccessMode(value) {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  if (normalized === "default") {
    return "current";
  }
  return normalized === "full-access" ? normalized : "";
}

function buildExecutionPolicies(accessMode, workspaceRoot) {
  if (accessMode === "full-access") {
    return {
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    };
  }
  const normalizedWorkspaceRoot = normalizeNonEmptyString(workspaceRoot);
  const writableRoots = normalizedWorkspaceRoot ? [normalizedWorkspaceRoot] : [];
  const sandboxPolicy = writableRoots.length
    ? { type: "workspaceWrite", writableRoots, networkAccess: true }
    : { type: "workspaceWrite", networkAccess: true };
  return {
    approvalPolicy: "on-request",
    sandboxPolicy,
  };
}

module.exports = { CodexRpcClient };
