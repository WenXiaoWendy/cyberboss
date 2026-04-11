class ThreadStateStore {
  constructor() {
    this.stateByThreadId = new Map();
    this.latestUsage = null;
  }

  applyRuntimeEvent(event) {
    if (event?.type === "runtime.usage.updated") {
      this.latestUsage = {
        ...event.payload,
        updatedAt: new Date().toISOString(),
      };
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
        next.lastError = event.payload.text || "Execution failed";
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

  getLatestUsage() {
    return this.latestUsage ? { ...this.latestUsage } : null;
  }
}

function createEmptyThreadState(threadId) {
  return {
    threadId,
    turnId: "",
    status: "idle",
    lastReplyText: "",
    lastError: "",
    pendingApproval: null,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { ThreadStateStore };
