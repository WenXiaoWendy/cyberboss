const fs = require("fs");
const path = require("path");
const { createWeixinChannelAdapter } = require("../adapters/channel/weixin");
const { createCodexRuntimeAdapter } = require("../adapters/runtime/codex");
const { findModelByQuery } = require("../adapters/runtime/codex/model-catalog");
const { createTimelineIntegration } = require("../integrations/timeline");
const { buildWeixinHelpText } = require("./command-registry");
const { StreamDelivery } = require("./stream-delivery");
const { ThreadStateStore } = require("./thread-state-store");

class CyberbossApp {
  constructor(config) {
    this.config = config;
    this.channelAdapter = createWeixinChannelAdapter(config);
    this.runtimeAdapter = createCodexRuntimeAdapter(config);
    this.timelineIntegration = createTimelineIntegration(config);
    this.threadStateStore = new ThreadStateStore();
    this.streamDelivery = new StreamDelivery({
      channelAdapter: this.channelAdapter,
      sessionStore: this.runtimeAdapter.getSessionStore(),
    });
    this.runtimeAdapter.onEvent((event) => {
      this.threadStateStore.applyRuntimeEvent(event);
      void this.handleRuntimeEvent(event);
    });
  }

  printDoctor() {
    console.log(JSON.stringify({
      stateDir: this.config.stateDir,
      channel: this.channelAdapter.describe(),
      runtime: this.runtimeAdapter.describe(),
      timeline: this.timelineIntegration.describe(),
      threads: this.threadStateStore.snapshot(),
    }, null, 2));
  }

  async login() {
    await this.channelAdapter.login();
  }

  printAccounts() {
    this.channelAdapter.printAccounts();
  }

  async start() {
    const account = this.channelAdapter.resolveAccount();
    const runtimeState = await this.runtimeAdapter.initialize();
    const knownContextTokens = Object.keys(this.channelAdapter.getKnownContextTokens()).length;
    const syncBuffer = this.channelAdapter.loadSyncBuffer();

    console.log("[cyberboss] bootstrap ok");
    console.log(`[cyberboss] channel=${this.channelAdapter.describe().id}`);
    console.log(`[cyberboss] runtime=${this.runtimeAdapter.describe().id}`);
    console.log(`[cyberboss] timeline=${this.timelineIntegration.describe().id}`);
    console.log(`[cyberboss] account=${account.accountId}`);
    console.log(`[cyberboss] baseUrl=${account.baseUrl}`);
    console.log(`[cyberboss] workspaceRoot=${this.config.workspaceRoot}`);
    console.log(`[cyberboss] knownContextTokens=${knownContextTokens}`);
    console.log(`[cyberboss] syncBuffer=${syncBuffer ? "ready" : "empty"}`);
    console.log(`[cyberboss] codexEndpoint=${runtimeState.endpoint}`);
    console.log(`[cyberboss] codexModels=${runtimeState.models.length}`);
    console.log("[cyberboss] 最小消息链路已启动，正在等待微信消息。");

    const shutdown = createShutdownController(async () => {
      await this.runtimeAdapter.close();
    });

    try {
      while (!shutdown.stopped) {
        const response = await this.channelAdapter.getUpdates({
          syncBuffer: this.channelAdapter.loadSyncBuffer(),
        });
        const messages = Array.isArray(response?.msgs) ? response.msgs : [];
        for (const message of messages) {
          if (shutdown.stopped) {
            break;
          }
          await this.handleIncomingMessage(message);
        }
      }
    } finally {
      shutdown.dispose();
      await this.runtimeAdapter.close();
    }
  }

  async handleIncomingMessage(message) {
    const normalized = this.channelAdapter.normalizeIncomingMessage(message);
    if (!normalized) {
      return;
    }

    const command = parseChannelCommand(normalized.text);
    if (command) {
      await this.dispatchChannelCommand(normalized, command);
      return;
    }

    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    this.streamDelivery.setReplyTarget(bindingKey, {
      userId: normalized.senderId,
      contextToken: normalized.contextToken,
    });

    await this.channelAdapter.sendTyping({
      userId: normalized.senderId,
      status: 1,
      contextToken: normalized.contextToken,
    }).catch(() => {});

    try {
      const result = await this.runtimeAdapter.sendTextTurn({
        bindingKey,
        workspaceRoot,
        text: normalized.text,
        model: this.runtimeAdapter.getSessionStore().getCodexParamsForWorkspace(bindingKey, workspaceRoot).model,
        metadata: {
          workspaceId: normalized.workspaceId,
          accountId: normalized.accountId,
          senderId: normalized.senderId,
        },
      });
      await this.streamDelivery.finishTurn({
        threadId: result.threadId,
        finalText: result.text,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error || "unknown error");
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `处理失败：${messageText}`,
        contextToken: normalized.contextToken,
      }).catch(() => {});
    } finally {
      await this.channelAdapter.sendTyping({
        userId: normalized.senderId,
        status: 0,
        contextToken: normalized.contextToken,
      }).catch(() => {});
    }
  }

  async dispatchChannelCommand(normalized, command) {
    switch (command.name) {
      case "bind":
        await this.handleBindCommand(normalized, command);
        return;
      case "status":
        await this.handleStatusCommand(normalized);
        return;
      case "new":
        await this.handleNewCommand(normalized);
        return;
      case "switch":
        await this.handleSwitchCommand(normalized, command);
        return;
      case "stop":
        await this.handleStopCommand(normalized);
        return;
      case "yes":
      case "always":
      case "no":
        await this.handleApprovalCommand(normalized, command);
        return;
      case "model":
        await this.handleModelCommand(normalized, command);
        return;
      case "send":
        await this.handleSendCommand(normalized, command);
        return;
      case "help":
        await this.handleHelpCommand(normalized);
        return;
      default:
        await this.channelAdapter.sendText({
          userId: normalized.senderId,
          text: buildWeixinHelpText(),
          contextToken: normalized.contextToken,
        });
    }
  }

  async handleBindCommand(normalized, command) {
    const workspaceRoot = normalizeWorkspacePath(command.args);
    if (!workspaceRoot) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "用法：/bind /绝对路径",
        contextToken: normalized.contextToken,
      });
      return;
    }

    if (!isAbsoluteWorkspacePath(workspaceRoot)) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "只支持绝对路径绑定。",
        contextToken: normalized.contextToken,
      });
      return;
    }

    const stats = await fs.promises.stat(workspaceRoot).catch(() => null);
    if (!stats?.isDirectory()) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `项目不存在：${workspaceRoot}`,
        contextToken: normalized.contextToken,
      });
      return;
    }

    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    this.runtimeAdapter.getSessionStore().setActiveWorkspaceRoot(bindingKey, workspaceRoot);
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `已绑定项目。\n\nworkspace: ${workspaceRoot}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleStatusCommand(normalized) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const threadId = this.runtimeAdapter.getSessionStore().getThreadIdForWorkspace(bindingKey, workspaceRoot);
    const threadState = threadId ? this.threadStateStore.getThreadState(threadId) : null;
    const lines = [
      `workspace: ${workspaceRoot}`,
      `thread: ${threadId || "(none)"}`,
      `status: ${threadState?.status || "idle"}`,
      `model: ${this.runtimeAdapter.getSessionStore().getCodexParamsForWorkspace(bindingKey, workspaceRoot).model || "(default)"}`,
      `reply: ${threadState?.lastReplyText || "(none)"}`,
      "usage: (待接入)",
    ];
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: lines.join("\n"),
      contextToken: normalized.contextToken,
    });
  }

  async handleNewCommand(normalized) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    this.runtimeAdapter.getSessionStore().clearThreadIdForWorkspace(bindingKey, workspaceRoot);
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `已切到新线程草稿。\n\nworkspace: ${workspaceRoot}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleSwitchCommand(normalized, command) {
    const targetThreadId = normalizeCommandArgument(command.args);
    if (!targetThreadId) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "用法：/switch <threadId>",
        contextToken: normalized.contextToken,
      });
      return;
    }

    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    await this.runtimeAdapter.resumeThread({ threadId: targetThreadId });
    this.runtimeAdapter.getSessionStore().setThreadIdForWorkspace(bindingKey, workspaceRoot, targetThreadId);
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `已切换线程。\n\nworkspace: ${workspaceRoot}\nthread: ${targetThreadId}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleStopCommand(normalized) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const threadId = this.runtimeAdapter.getSessionStore().getThreadIdForWorkspace(bindingKey, workspaceRoot);
    const threadState = threadId ? this.threadStateStore.getThreadState(threadId) : null;
    if (!threadId || !threadState?.turnId || threadState.status !== "running") {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "当前没有正在运行的线程。",
        contextToken: normalized.contextToken,
      });
      return;
    }

    await this.runtimeAdapter.cancelTurn({
      threadId,
      turnId: threadState.turnId,
    });
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `已发送停止请求。\n\nthread: ${threadId}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleApprovalCommand(normalized, command) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const threadId = this.runtimeAdapter.getSessionStore().getThreadIdForWorkspace(bindingKey, workspaceRoot);
    const threadState = threadId ? this.threadStateStore.getThreadState(threadId) : null;
    const approval = threadState?.pendingApproval || null;
    if (!threadId || !approval?.requestId) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "当前没有待处理的授权请求。",
        contextToken: normalized.contextToken,
      });
      return;
    }

    const decision = command.name === "no" ? "decline" : "accept";
    await this.runtimeAdapter.respondApproval({
      requestId: approval.requestId,
      decision,
    });
    if (command.name === "always" && decision === "accept") {
      this.runtimeAdapter.getSessionStore().rememberApprovalPrefixForWorkspace(workspaceRoot, approval.commandTokens);
    }
    this.threadStateStore.resolveApproval(threadId, "running");
    const text = command.name === "always"
      ? "已记住该命令前缀，当前项目后续相同命令将自动放行。"
      : (command.name === "yes" ? "已允许本次请求。" : "已拒绝本次请求。");
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text,
      contextToken: normalized.contextToken,
    });
  }

  async handleModelCommand(normalized, command) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const query = normalizeCommandArgument(command.args);
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const catalog = sessionStore.getAvailableModelCatalog();
    const currentModel = sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot).model;

    if (!query) {
      const lines = [
        `当前模型: ${currentModel || "(default)"}`,
      ];
      if (catalog?.models?.length) {
        lines.push(`可用模型: ${catalog.models.map((item) => item.model).join("、")}`);
      } else {
        lines.push("可用模型: (未获取到模型列表)");
      }
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: lines.join("\n"),
        contextToken: normalized.contextToken,
      });
      return;
    }

    const matched = findModelByQuery(catalog?.models || [], query);
    if (!matched) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `未找到模型：${query}`,
        contextToken: normalized.contextToken,
      });
      return;
    }

    sessionStore.setCodexParamsForWorkspace(bindingKey, workspaceRoot, {
      model: matched.model,
    });
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `已切换模型。\n\nworkspace: ${workspaceRoot}\nmodel: ${matched.model}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleSendCommand(normalized, command) {
    const requestedPath = normalizeCommandArgument(command.args);
    if (!requestedPath) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "用法：/send <相对路径>",
        contextToken: normalized.contextToken,
      });
      return;
    }

    if (path.isAbsolute(requestedPath)) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "只支持发送当前项目内的相对路径文件。",
        contextToken: normalized.contextToken,
      });
      return;
    }

    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const resolvedPath = path.resolve(workspaceRoot, requestedPath);
    const relativePath = path.relative(workspaceRoot, resolvedPath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "只支持发送当前项目内的文件。",
        contextToken: normalized.contextToken,
      });
      return;
    }

    const stats = await fs.promises.stat(resolvedPath).catch(() => null);
    if (!stats?.isFile()) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `文件不存在：${requestedPath}`,
        contextToken: normalized.contextToken,
      });
      return;
    }

    await this.channelAdapter.sendFile({
      userId: normalized.senderId,
      filePath: resolvedPath,
      contextToken: normalized.contextToken,
    });
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `已发送文件：${requestedPath}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleHelpCommand(normalized) {
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: buildWeixinHelpText(),
      contextToken: normalized.contextToken,
    });
  }

  resolveWorkspaceRoot(bindingKey) {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    return sessionStore.getActiveWorkspaceRoot(bindingKey) || this.config.workspaceRoot;
  }

  async handleRuntimeEvent(event) {
    await this.streamDelivery.handleRuntimeEvent(event);
    if (!event || event.type !== "runtime.approval.requested") {
      return;
    }
    const linked = this.runtimeAdapter.getSessionStore().findBindingForThreadId(event.payload.threadId);
    if (!linked?.workspaceRoot) {
      return;
    }
    const allowlist = this.runtimeAdapter.getSessionStore().getApprovalCommandAllowlistForWorkspace(linked.workspaceRoot);
    if (!matchesCommandPrefix(event.payload.commandTokens, allowlist)) {
      return;
    }
    await this.runtimeAdapter.respondApproval({
      requestId: event.payload.requestId,
      decision: "accept",
    }).catch(() => {});
    this.threadStateStore.resolveApproval(event.payload.threadId, "running");
  }
}

function createShutdownController(onStop) {
  let stopped = false;
  let stoppingPromise = null;

  const stop = async () => {
    if (stopped) {
      return stoppingPromise;
    }
    stopped = true;
    stoppingPromise = Promise.resolve().then(onStop);
    return stoppingPromise;
  };

  const handleSignal = () => {
    stop().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  return {
    get stopped() {
      return stopped;
    },
    dispose() {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    },
  };
}

module.exports = { CyberbossApp };

function parseChannelCommand(text) {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized.startsWith("/")) {
    return null;
  }
  const [rawName, ...rest] = normalized.slice(1).split(/\s+/);
  const name = normalizeCommandName(rawName);
  if (!name) {
    return null;
  }
  return {
    name,
    args: rest.join(" ").trim(),
  };
}

function normalizeCommandName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeWorkspacePath(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isAbsoluteWorkspacePath(value) {
  return typeof value === "string" && value.startsWith("/");
}

function normalizeCommandArgument(value) {
  return typeof value === "string" ? value.trim() : "";
}

function matchesCommandPrefix(commandTokens, allowlist) {
  const normalizedCommandTokens = Array.isArray(commandTokens)
    ? commandTokens.map((part) => normalizeCommandArgument(part)).filter(Boolean)
    : [];
  if (!normalizedCommandTokens.length || !Array.isArray(allowlist) || !allowlist.length) {
    return false;
  }
  return allowlist.some((prefix) => {
    if (!Array.isArray(prefix) || !prefix.length || prefix.length > normalizedCommandTokens.length) {
      return false;
    }
    return prefix.every((part, index) => normalizeCommandArgument(part) === normalizedCommandTokens[index]);
  });
}
