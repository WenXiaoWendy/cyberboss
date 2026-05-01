// CopilotSdkClient — wraps `@github/copilot-sdk` so the rest of the
// copilot adapter can speak in the same shape as
// `claudecode/process-client.js`. The wrapper is intentionally thin: it
// adapts SDK lifecycle calls and event names, but does not contain any
// approval policy, command parsing, or upstream event translation — those
// live in `index.js` and `events.js` respectively.

const { CopilotClient } = require("@github/copilot-sdk");

class CopilotSdkClient {
  constructor({
    command = "",
    endpoint = "",
    cwd = "",
    model = "",
    workspaceRoot = "",
    onPermissionRequest = null,
    mcpServers = null,
  } = {}) {
    this.command = command;
    this.endpoint = endpoint;
    this.cwd = cwd;
    this.model = model;
    this.workspaceRoot = workspaceRoot;
    // Default to a deny-all handler so a misuse path never accidentally
    // approves a tool call.
    this.onPermissionRequest = typeof onPermissionRequest === "function"
      ? onPermissionRequest
      : async () => ({ kind: "reject" });
    this.mcpServers = mcpServers && typeof mcpServers === "object" ? mcpServers : null;

    this.alive = false;
    this.sessionId = "";
    this.pendingTurnId = "";
    this.currentModel = "";

    this.listeners = new Set();
    this.client = null;
    this.session = null;
    this.connectPromise = null;
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event, raw) {
    for (const listener of this.listeners) {
      try {
        listener(event, raw);
      } catch {
        // ignore listener errors
      }
    }
  }

  buildClientOptions() {
    const options = { useLoggedInUser: true };
    if (this.endpoint) {
      options.cliUrl = this.endpoint;
    } else if (this.command) {
      options.cliPath = this.command;
    }
    return options;
  }

  buildSessionOptions() {
    const options = {
      model: this.model || undefined,
      workingDirectory: this.cwd || undefined,
      enableConfigDiscovery: true,
      onPermissionRequest: (request) => this.onPermissionRequest(request),
    };
    if (this.mcpServers) {
      options.mcpServers = this.mcpServers;
    }
    return options;
  }

  async connect(resumeSessionId = "") {
    // De-dupe concurrent connect() calls. Without this, a second
    // `sendTextTurn` arriving while the first connect is mid-flight would
    // see `this.client` already non-null, return early, and then call
    // `sendUserMessage` against a still-null `this.session`.
    if (this.alive) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      // Stop any previously-started client that failed mid-connect
      // (e.g. start() succeeded but resumeSession() threw), to avoid
      // leaking orphaned SDK processes.
      if (this.client && typeof this.client.stop === "function") {
        try { await this.client.stop(); } catch {}
      }
      this.client = new CopilotClient(this.buildClientOptions());
      await this.client.start();

      const sessionOptions = this.buildSessionOptions();
      if (resumeSessionId) {
        this.session = await this.client.resumeSession(resumeSessionId, sessionOptions);
      } else {
        this.session = await this.client.createSession(sessionOptions);
      }

      this.sessionId =
        (this.session && (this.session.sessionId || this.session.id)) || resumeSessionId || "";
      this.alive = true;
      this.subscribeSessionEvents();
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  subscribeSessionEvents() {
    if (!this.session) return;

    // Normalize SDK event payloads (`event.data.*`) into the flat shape
    // events.js expects. Keep names as `assistant.delta` /
    // `assistant.complete` / `idle` / `error` so the event-translation
    // layer stays runtime-agnostic.
    const onDelta = (event) => {
      const data = (event && event.data) || {};
      const payload = {
        delta: typeof data.deltaContent === "string" ? data.deltaContent : "",
        messageId: typeof data.messageId === "string" ? data.messageId : "",
      };
      this.emit({ type: "assistant.delta", payload }, event);
    };
    const onMessage = (event) => {
      const data = (event && event.data) || {};
      const payload = {
        text: typeof data.content === "string" ? data.content : "",
        messageId: typeof data.messageId === "string" ? data.messageId : "",
      };
      this.emit({ type: "assistant.complete", payload }, event);
    };
    const onIdle = (event) => {
      this.emit({ type: "idle", payload: (event && event.data) || {} }, event);
    };
    const onError = (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit({ type: "error", error, message: error.message }, err);
    };
    const onUsageInfo = (event) => {
      const data = (event && event.data) || {};
      const payload = {
        currentTokens: Number(data.currentTokens),
        tokenLimit: Number(data.tokenLimit),
        messagesLength: Number(data.messagesLength),
        model: this.currentModel || "",
      };
      this.emit({ type: "session.usage_info", payload }, event);
    };
    const onSessionStart = (event) => {
      const data = (event && event.data) || {};
      if (typeof data.selectedModel === "string" && data.selectedModel) {
        this.currentModel = data.selectedModel;
      }
    };
    const onModelChange = (event) => {
      const data = (event && event.data) || {};
      if (typeof data.newModel === "string" && data.newModel) {
        this.currentModel = data.newModel;
      }
    };
    const onAssistantUsage = (event) => {
      const data = (event && event.data) || {};
      if (typeof data.model === "string" && data.model) {
        this.currentModel = data.model;
      }
    };

    if (typeof this.session.on === "function") {
      this.session.on("assistant.message_delta", onDelta);
      this.session.on("assistant.message", onMessage);
      this.session.on("session.idle", onIdle);
      this.session.on("session.error", onError);
      this.session.on("session.usage_info", onUsageInfo);
      this.session.on("session.start", onSessionStart);
      this.session.on("session.model_change", onModelChange);
      this.session.on("assistant.usage", onAssistantUsage);
    }
    if (this.client && typeof this.client.on === "function") {
      this.client.on("error", onError);
    }
  }

  async sendUserMessage({ text } = {}) {
    if (!this.session) {
      throw new Error("CopilotSdkClient.sendUserMessage: session is not connected");
    }
    const result = await this.session.send({ prompt: text });
    // SDK contract: `session.send` resolves to `Promise<string>` (the
    // assistant message id). Accept the legacy `{messageId}` shape as
    // forward-compat fallback.
    const messageId =
      typeof result === "string" ? result : (result && result.messageId) || "";
    this.pendingTurnId = messageId;
    this.emit({ type: "message.sent", messageId, text }, result);
    return messageId;
  }

  async abort() {
    if (this.session && typeof this.session.abort === "function") {
      try {
        await this.session.abort();
      } catch (err) {
        console.error(
          "[copilot-runtime] session.abort failed:",
          err && err.message ? err.message : err,
        );
      }
    }
  }

  async close() {
    const session = this.session;
    const client = this.client;
    this.session = null;
    this.client = null;
    this.alive = false;
    this.sessionId = "";
    this.pendingTurnId = "";
    this.currentModel = "";
    this.listeners.clear();

    if (session && typeof session.disconnect === "function") {
      try {
        await session.disconnect();
      } catch (err) {
        console.error(
          "[copilot-runtime] session.disconnect failed:",
          err && err.message ? err.message : err,
        );
      }
    }
    if (client && typeof client.stop === "function") {
      try {
        await client.stop();
      } catch (err) {
        console.error(
          "[copilot-runtime] client.stop failed:",
          err && err.message ? err.message : err,
        );
      }
    }
  }
}

module.exports = { CopilotSdkClient };
