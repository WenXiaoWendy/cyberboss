// Copilot runtime adapter (rebuilt on top of upstream/main's
// project-native-tools architecture).
//
// Layout mirrors `claudecode/index.js`:
//   - one CopilotSdkClient per workspaceRoot, lazily created
//   - permission requests are bridged via a per-thread FIFO so
//     ThreadStateStore (which only tracks one pending approval per
//     thread) sees them one at a time
//   - cyberboss tools are exposed to the SDK via the standard
//     `mcpServers` field, pointing at `bin/cyberboss.js tool-mcp-server
//     --runtime-id copilot` (parallel to codex's mcp-config.js).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { CopilotSdkClient } = require("./client-wrapper");
const { mapCopilotMessageToRuntimeEvent } = require("./events");
const { buildApprovalFields } = require("./message-utils");
const { resolveCopilotProjectToolMcpServerConfig } = require("./mcp-config");
const { SessionStore } = require("../codex/session-store");
const { buildOpeningTurnText, buildInstructionRefreshText } = require("../shared-instructions");

const MAX_PENDING_APPROVALS = 100;
const TRUSTED_MCP_SERVER_NAME = "cyberboss_tools";

function isPathWithinAnyRoot(targetPath, roots) {
  if (!targetPath) return false;
  for (const root of roots) {
    if (!root) continue;
    const logicalRoot = path.resolve(root);
    let realRoot;
    try { realRoot = fs.realpathSync(logicalRoot); } catch { realRoot = logicalRoot; }

    const rawTarget = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(logicalRoot, targetPath);

    // Try full realpath first (resolves symlinks).
    let resolvedTarget;
    let usedRealpath = false;
    try {
      resolvedTarget = fs.realpathSync(rawTarget);
      usedRealpath = true;
    } catch {
      // Target may not exist yet (e.g. new file write). Resolve parent.
      try {
        const parentReal = fs.realpathSync(path.dirname(rawTarget));
        resolvedTarget = path.join(parentReal, path.basename(rawTarget));
        usedRealpath = true;
      } catch {
        resolvedTarget = rawTarget;
      }
    }

    // Compare against realRoot when we resolved the target via realpath,
    // otherwise compare against the logical root (both sides use the
    // same resolution strategy).
    const compareRoot = usedRealpath ? realRoot : logicalRoot;
    if (resolvedTarget === compareRoot) return true;
    if (resolvedTarget.startsWith(compareRoot + path.sep)) return true;
  }
  return false;
}

function createCopilotRuntimeAdapter(config) {
  const sessionStore = new SessionStore({ filePath: config.sessionsFile, runtimeId: "copilot" });
  const clientsByWorkspace = new Map();
  const pendingApprovals = new Map();
  // Per-thread FIFO of approval requests. The SDK fires
  // `onPermissionRequest` concurrently for parallel tool calls, but
  // ThreadStateStore tracks exactly one `pendingApproval` per thread —
  // emitting a second prompt would silently overwrite the first. We
  // serialize: only the queue head is published as
  // `runtime.approval.requested`, and `respondApproval` promotes the
  // next entry.
  const approvalQueueByThread = new Map();
  let globalListener = null;

  const trustedRoots = [config.workspaceRoot, config.stateDir].filter(Boolean);
  const projectMcpServerConfig = resolveCopilotProjectToolMcpServerConfig({
    cyberbossHome: process.env.CYBERBOSS_HOME || "",
  });
  const mcpServers = projectMcpServerConfig
    ? {
      [projectMcpServerConfig.name]: {
        type: "stdio",
        command: projectMcpServerConfig.command,
        args: projectMcpServerConfig.args,
        // SDK requires `tools`; "*" exposes every tool the MCP server
        // advertises. The cyberboss tool host advertises a curated set,
        // so this is safe.
        tools: ["*"],
      },
    }
    : null;

  function emitRuntimeEvent(mapped, raw) {
    if (mapped && globalListener) {
      globalListener(mapped, raw);
    }
  }

  function emitTurnStarted({ threadId, turnId }) {
    emitRuntimeEvent(
      {
        type: "runtime.turn.started",
        payload: { threadId, turnId },
      },
      null,
    );
  }

  // ---------- Permission policy ----------

  // Auto-approve safe `kind`s. The SDK does not provide a sandbox like
  // codex CLI, so this function is the explicit equivalent. Anything
  // that returns false bubbles up to the user via the wechat approval
  // flow.
  function shouldAutoApprove(request, workspaceRoot) {
    if (!request || typeof request !== "object") return false;
    const kind = request.kind;

    // 1) Trusted MCP server: every tool from `cyberboss_tools` is one
    //    of our own services (reminder/diary/timeline/...). They run
    //    in-process under our control, so we approve unconditionally.
    if (kind === "mcp" && request.serverName === TRUSTED_MCP_SERVER_NAME) {
      return true;
    }

    // 2) Memory is always safe; reads only within trusted roots.
    if (kind === "memory") return true;
    if (kind === "read") {
      const roots = workspaceRoot ? [workspaceRoot, ...trustedRoots] : trustedRoots;
      return isPathWithinAnyRoot(request.fileName || request.path, roots);
    }

    // 3) Writes inside a trusted root (workspace + state dir).
    if (kind === "write") {
      const roots = workspaceRoot ? [workspaceRoot, ...trustedRoots] : trustedRoots;
      return isPathWithinAnyRoot(request.fileName, roots);
    }

    // 4) Shell: read-only command pipelines, or mutating shell whose
    //    SDK-extracted `possiblePaths` are all inside a trusted root.
    if (kind === "shell") {
      if (request.hasWriteFileRedirection) return false;
      const commands = Array.isArray(request.commands) ? request.commands : [];
      if (commands.length === 0) return false;
      const roots = workspaceRoot ? [workspaceRoot, ...trustedRoots] : trustedRoots;
      const paths = Array.isArray(request.possiblePaths)
        ? request.possiblePaths.filter((p) => typeof p === "string" && p)
        : [];
      if (paths.length === 0) return false;
      return paths.every((p) => isPathWithinAnyRoot(p, roots));
    }

    return false;
  }

  function emitApprovalPrompt(threadId, requestId, request) {
    const fields = buildApprovalFields(request);
    emitRuntimeEvent(
      {
        type: "runtime.approval.requested",
        payload: {
          threadId,
          requestId,
          reason: fields.toolName ? `Tool: ${fields.toolName}` : "",
          command: fields.command,
          filePath: fields.filePath,
          filePaths: fields.filePaths,
          commandTokens: fields.commandTokens,
        },
      },
      request,
    );
  }

  function dropApprovalFromQueue(threadId, requestId) {
    const queue = approvalQueueByThread.get(threadId);
    if (!queue) return;
    const idx = queue.findIndex((q) => q.requestId === requestId);
    if (idx >= 0) queue.splice(idx, 1);
    if (queue.length === 0) {
      approvalQueueByThread.delete(threadId);
    } else if (idx === 0) {
      const next = queue[0];
      emitApprovalPrompt(threadId, next.requestId, next.request);
    }
  }

  function handlePermissionRequest({ workspaceRoot, threadId, request }) {
    if (shouldAutoApprove(request, workspaceRoot)) {
      return Promise.resolve({ kind: "approve-once" });
    }

    if (pendingApprovals.size >= MAX_PENDING_APPROVALS) {
      const oldestKey = pendingApprovals.keys().next().value;
      const oldest = pendingApprovals.get(oldestKey);
      pendingApprovals.delete(oldestKey);
      if (oldest) {
        if (oldest.threadId) dropApprovalFromQueue(oldest.threadId, oldestKey);
        if (typeof oldest.resolve === "function") {
          oldest.resolve({ kind: "reject" });
        }
      }
    }

    const requestId = crypto.randomUUID();
    const promise = new Promise((resolve) => {
      pendingApprovals.set(requestId, { resolve, workspaceRoot, threadId });
    });

    const queue = approvalQueueByThread.get(threadId) || [];
    queue.push({ requestId, request });
    approvalQueueByThread.set(threadId, queue);
    if (queue.length === 1) {
      emitApprovalPrompt(threadId, requestId, request);
    }

    return promise;
  }

  // ---------- Client lifecycle ----------

  function ensureClient(workspaceRoot) {
    let client = clientsByWorkspace.get(workspaceRoot);
    if (client) return client;

    client = new CopilotSdkClient({
      command: config.copilotCommand || "",
      endpoint: config.copilotEndpoint || "",
      cwd: workspaceRoot,
      model: config.copilotModel || "",
      workspaceRoot,
      mcpServers,
      onPermissionRequest: (request) =>
        handlePermissionRequest({
          workspaceRoot,
          threadId: client ? client.sessionId : "",
          request,
        }),
    });

    let activeTurnText = "";
    client.onMessage((event, raw) => {
      if (event && event.type === "assistant.delta") {
        const delta = (event.payload && (event.payload.delta || event.payload.text)) || "";
        if (typeof delta === "string") activeTurnText += delta;
      } else if (event && event.type === "assistant.complete") {
        const completeText =
          (event.payload && typeof event.payload.text === "string" && event.payload.text) || "";
        if (completeText) activeTurnText = completeText;
      }
      const context = {
        threadId: client.sessionId,
        turnId: client.pendingTurnId,
        text: activeTurnText,
      };
      const mapped = mapCopilotMessageToRuntimeEvent(event, context);
      if (mapped?.type === "runtime.turn.failed") {
        // Drain pending approvals and close the SDK client to avoid
        // leaked processes and permanently-hanging approval promises.
        const drainedThreadIds = new Set();
        for (const [requestId, entry] of pendingApprovals.entries()) {
          if (entry && entry.workspaceRoot === workspaceRoot) {
            pendingApprovals.delete(requestId);
            if (entry.threadId) drainedThreadIds.add(entry.threadId);
            if (typeof entry.resolve === "function") {
              entry.resolve({ kind: "reject" });
            }
          }
        }
        for (const tid of drainedThreadIds) {
          approvalQueueByThread.delete(tid);
        }
        clientsByWorkspace.delete(workspaceRoot);
        client.close().catch((err) => {
          console.error(
            "[copilot-runtime] async close after turn.failed:",
            err && err.message ? err.message : err,
          );
        });
      }
      emitRuntimeEvent(mapped, raw);
      if (event && (event.type === "idle" || event.type === "error")) {
        activeTurnText = "";
      }
    });

    clientsByWorkspace.set(workspaceRoot, client);
    return client;
  }

  async function closeWorkspaceClient(workspaceRoot) {
    // Drain pending approvals BEFORE disconnecting the SDK client, or
    // `session.disconnect()` may hang on an awaited permission promise.
    const drainedThreadIds = new Set();
    for (const [requestId, entry] of pendingApprovals.entries()) {
      if (entry && entry.workspaceRoot === workspaceRoot) {
        pendingApprovals.delete(requestId);
        if (entry.threadId) drainedThreadIds.add(entry.threadId);
        if (typeof entry.resolve === "function") {
          entry.resolve({ kind: "reject" });
        }
      }
    }
    for (const threadId of drainedThreadIds) {
      approvalQueueByThread.delete(threadId);
    }

    const client = clientsByWorkspace.get(workspaceRoot);
    if (!client) return;
    clientsByWorkspace.delete(workspaceRoot);
    try {
      await client.close();
    } catch (err) {
      console.error(
        "[copilot-runtime] close failed:",
        err && err.message ? err.message : err,
      );
    }
  }

  // ---------- Adapter contract ----------

  return {
    describe() {
      return {
        id: "copilot",
        kind: "runtime",
        endpoint: config.copilotEndpoint || "(spawn)",
        command: config.copilotCommand || "(sdk-bundled)",
        sessionsFile: config.sessionsFile,
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
    async initialize() {
      // Mirrors codex: do not eagerly enumerate models — the SDK loads
      // them lazily on first session.send. Callers that need a list can
      // surface it separately later.
      return {
        endpoint: config.copilotEndpoint || "(spawn)",
        command: config.copilotCommand || "(sdk-bundled)",
        models: [],
      };
    },
    async close() {
      const workspaceRoots = Array.from(clientsByWorkspace.keys());
      for (const workspaceRoot of workspaceRoots) {
        await closeWorkspaceClient(workspaceRoot);
      }
      clientsByWorkspace.clear();
    },
    async startFreshThreadDraft({ workspaceRoot } = {}) {
      if (workspaceRoot) {
        await closeWorkspaceClient(workspaceRoot);
      }
      return { workspaceRoot };
    },
    async respondApproval({ requestId, decision }) {
      const entry = pendingApprovals.get(requestId);
      if (!entry) {
        throw new Error(`copilot adapter: no pending approval for requestId ${requestId}`);
      }
      pendingApprovals.delete(requestId);
      // SDK PermissionDecision: `"approve-once"` / `"reject"`. The
      // legacy `{decision:"allow"}` shape silently fails open and the
      // tool stays blocked.
      const sdkDecision = decision === "accept" ? { kind: "approve-once" } : { kind: "reject" };
      const normalizedDecision = decision === "accept" ? "accept" : "decline";
      entry.resolve(sdkDecision);
      if (entry.threadId) {
        dropApprovalFromQueue(entry.threadId, requestId);
      }
      return { requestId, decision: normalizedDecision };
    },
    async cancelTurn({ threadId, turnId }) {
      // 1) Reject every pending approval bound to this thread before
      //    aborting, otherwise the SDK stays parked on the permission
      //    promise and the next sendUserMessage hangs forever.
      // 2) Synthesize a `runtime.turn.failed` so ThreadStateStore /
      //    turnGate / typing indicator all reset — `session.abort()`
      //    does not reliably emit `session.idle`.
      let aborted = false;
      let resolvedTurnId = turnId;
      for (const client of clientsByWorkspace.values()) {
        if (!client || client.sessionId !== threadId) continue;
        for (const [requestId, entry] of pendingApprovals.entries()) {
          if (entry && entry.workspaceRoot === client.workspaceRoot) {
            pendingApprovals.delete(requestId);
            if (typeof entry.resolve === "function") {
              entry.resolve({ kind: "reject" });
            }
          }
        }
        approvalQueueByThread.delete(threadId);
        if (!resolvedTurnId && client.pendingTurnId) {
          resolvedTurnId = client.pendingTurnId;
        }
        await client.abort();
        aborted = true;
        break;
      }
      if (aborted) {
        emitRuntimeEvent(
          {
            type: "runtime.turn.failed",
            payload: {
              threadId,
              turnId: resolvedTurnId || "",
              text: "⏹️ Turn cancelled.",
            },
          },
          null,
        );
      }
      return { threadId, turnId: resolvedTurnId };
    },
    async resumeThread({ threadId, workspaceRoot } = {}) {
      if (!workspaceRoot) {
        return { threadId };
      }
      const client = ensureClient(workspaceRoot);
      if (!client.alive) {
        await client.connect(threadId || "");
      }
      return { threadId };
    },
    async compactThread({ threadId, workspaceRoot } = {}) {
      // Copilot SDK does not yet expose a public compaction endpoint —
      // surface a graceful "not supported" rather than a hard throw so
      // callers can branch safely.
      void threadId;
      void workspaceRoot;
      return {
        threadId,
        turnId: "",
        text: "Compaction is not supported by the copilot runtime yet.",
      };
    },
    async refreshThreadInstructions({ threadId, workspaceRoot, model: _model = "" } = {}) {
      const client = ensureClient(workspaceRoot);
      if (!client.alive) {
        await client.connect(threadId || "");
      }
      const refreshText = buildInstructionRefreshText(config);
      const turnId = await client.sendUserMessage({ text: refreshText });
      const resolvedThreadId = client.sessionId || threadId;
      emitTurnStarted({ threadId: resolvedThreadId, turnId });
      return { threadId: resolvedThreadId, turnId };
    },
    async sendTextTurn({
      bindingKey,
      workspaceRoot,
      text,
      metadata = {},
      model: _model = "",
    } = {}) {
      const storedThreadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      let isOpening = !storedThreadId;
      let client = ensureClient(workspaceRoot);

      if (client.alive && storedThreadId && client.sessionId !== storedThreadId) {
        await closeWorkspaceClient(workspaceRoot);
        client = ensureClient(workspaceRoot);
      }

      if (!client.alive) {
        try {
          await client.connect(storedThreadId || "");
        } catch (err) {
          // The stored threadId may belong to a different runtime (the
          // SessionStore is keyed by workspace, not by runtime). Recover
          // by discarding the wrapper and starting a fresh session
          // rather than dying at the user.
          const message = err && err.message ? err.message : String(err);
          if (storedThreadId && /not found|unknown session|no such session/i.test(message)) {
            console.error(
              `[copilot-runtime] resume failed for threadId ${storedThreadId}; starting fresh session: ${message}`,
            );
            await closeWorkspaceClient(workspaceRoot);
            client = ensureClient(workspaceRoot);
            await client.connect("");
            isOpening = true;
          } else {
            throw err;
          }
        }
      }

      const outboundText = isOpening ? buildOpeningTurnText(config, text) : text;
      const turnId = await client.sendUserMessage({ text: outboundText });
      const threadId = client.sessionId;

      if (threadId) {
        sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
      }

      emitTurnStarted({ threadId, turnId });
      return { threadId, turnId };
    },

    // Test-only hooks. Not part of the public adapter contract.
    __test__: {
      handlePermissionRequest,
      shouldAutoApprove,
      pendingApprovalsSize: () => pendingApprovals.size,
      approvalQueueSize: (threadId) =>
        (approvalQueueByThread.get(threadId) || []).length,
      mcpServers,
      trustedRoots,
    },
  };
}

module.exports = {
  createCopilotRuntimeAdapter,
  MAX_PENDING_APPROVALS,
  TRUSTED_MCP_SERVER_NAME,
};
