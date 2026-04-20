class ThreadStateStore {
  constructor() {
    this.stateByThreadId = new Map();
    this.latestContextByRuntime = new Map();
  }

  applyRuntimeEvent(event) {
    if (event?.type === "runtime.context.updated") {
      const updatedAt = new Date().toISOString();
      const runtimeId = normalizeRuntimeId(event?.payload?.runtimeId);
      const snapshot = {
        ...event.payload,
        updatedAt,
      };
      if (runtimeId) {
        this.latestContextByRuntime.set(runtimeId, snapshot);
      }
      const threadId = normalizeThreadId(event?.payload?.threadId);
      if (threadId) {
        const current = this.stateByThreadId.get(threadId) || createEmptyThreadState(threadId);
        this.stateByThreadId.set(threadId, {
          ...current,
          context: snapshot,
          updatedAt,
        });
      }
      return;
    }
    if (!event || !event.payload || !event.payload.threadId) {
      return;
    }

    const threadId = event.payload.threadId;
    const current = this.stateByThreadId.get(threadId) || createEmptyThreadState(threadId);
    const next = {
      ...current,
      updatedAt: new Date().toISOString(),
    };

    switch (event.type) {
      case "runtime.turn.started":
        next.status = "running";
        next.turnId = event.payload.turnId || next.turnId;
        next.lastError = "";
        break;
      case "runtime.reply.delta":
        next.status = "running";
        next.turnId = event.payload.turnId || next.turnId;
        next.lastReplyText = event.payload.text || next.lastReplyText;
        break;
      case "runtime.reply.completed":
        next.status = "running";
        next.turnId = event.payload.turnId || next.turnId;
        next.lastReplyText = event.payload.text || next.lastReplyText;
        break;
      case "runtime.approval.requested":
        next.status = "waiting_approval";
        next.pendingApproval = {
          requestId: event.payload.requestId ?? null,
          reason: event.payload.reason || "",
          command: event.payload.command || "",
          commandTokens: Array.isArray(event.payload.commandTokens) ? event.payload.commandTokens : [],
        };
        break;
      case "runtime.turn.completed":
        next.status = "idle";
        next.turnId = event.payload.turnId || next.turnId;
        next.pendingApproval = null;
        break;
      case "runtime.turn.failed":
        next.status = "failed";
        next.turnId = event.payload.turnId || next.turnId;
        next.lastError = event.payload.text || "❌ Execution failed";
        next.pendingApproval = null;
        break;
      default:
        break;
    }

    this.stateByThreadId.set(threadId, next);
  }

  getThreadState(threadId) {
    return this.stateByThreadId.get(threadId) || null;
  }

  resolveApproval(threadId, status = "running") {
    const current = this.stateByThreadId.get(threadId);
    if (!current) {
      return null;
    }
    const next = {
      ...current,
      status,
      pendingApproval: null,
      updatedAt: new Date().toISOString(),
    };
    this.stateByThreadId.set(threadId, next);
    return next;
  }

  snapshot() {
    return Array.from(this.stateByThreadId.values()).map((entry) => ({ ...entry }));
  }

  getLatestContext(runtimeId) {
    const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
    if (!normalizedRuntimeId) {
      return null;
    }
    const snapshot = this.latestContextByRuntime.get(normalizedRuntimeId);
    return snapshot ? { ...snapshot } : null;
  }
}

function createEmptyThreadState(threadId) {
  return {
    threadId,
    turnId: "",
    status: "idle",
    lastReplyText: "",
    lastError: "",
    context: null,
    pendingApproval: null,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeRuntimeId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeThreadId(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { ThreadStateStore };
