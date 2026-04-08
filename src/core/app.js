const os = require("os");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { createWeixinChannelAdapter } = require("../adapters/channel/weixin");
const { persistIncomingWeixinAttachments } = require("../adapters/channel/weixin/media-receive");
const { createCodexRuntimeAdapter } = require("../adapters/runtime/codex");
const { findModelByQuery } = require("../adapters/runtime/codex/model-catalog");
const { createTimelineIntegration } = require("../integrations/timeline");
const { buildWeixinHelpText } = require("./command-registry");
const { resolvePreferredSenderId } = require("./default-targets");
const { StreamDelivery } = require("./stream-delivery");
const { ThreadStateStore } = require("./thread-state-store");
const { SystemMessageQueueStore } = require("./system-message-queue-store");
const { SystemMessageDispatcher } = require("./system-message-dispatcher");
const { TimelineScreenshotQueueStore } = require("./timeline-screenshot-queue-store");
const { ReminderQueueStore } = require("../adapters/channel/weixin/reminder-queue-store");
const { runSystemCheckinPoller } = require("../app/system-checkin-poller");

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MIN_LONG_POLL_TIMEOUT_MS = 2_000;
const SESSION_EXPIRED_ERRCODE = -14;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const FIRST_RUNTIME_EVENT_NOTICE_TIMEOUT_MS = 8_000;
const FIRST_RUNTIME_EVENT_FAILURE_TIMEOUT_MS = 45_000;

class CyberbossApp {
  constructor(config) {
    this.config = config;
    this.channelAdapter = createWeixinChannelAdapter(config);
    this.runtimeAdapter = createCodexRuntimeAdapter(config);
    this.timelineIntegration = createTimelineIntegration(config);
    this.threadStateStore = new ThreadStateStore();
    this.systemMessageQueue = new SystemMessageQueueStore({ filePath: config.systemMessageQueueFile });
    this.timelineScreenshotQueue = new TimelineScreenshotQueueStore({ filePath: config.timelineScreenshotQueueFile });
    this.reminderQueue = new ReminderQueueStore({ filePath: config.reminderQueueFile });
    this.systemMessageDispatcher = null;
    this.streamDelivery = new StreamDelivery({
      channelAdapter: this.channelAdapter,
      sessionStore: this.runtimeAdapter.getSessionStore(),
    });
    this.pendingRuntimeEventWatchdogs = new Map();
    this.runtimeEventChain = Promise.resolve();
    this.runtimeAdapter.onEvent((event) => {
      this.clearRuntimeEventWatchdog(event?.payload?.threadId);
      this.threadStateStore.applyRuntimeEvent(event);
      this.runtimeEventChain = this.runtimeEventChain
        .catch(() => {})
        .then(() => this.handleRuntimeEvent(event))
        .catch((error) => {
          const message = error instanceof Error ? error.stack || error.message : String(error);
          console.error(`[cyberboss] runtime event handling failed type=${event?.type || "(unknown)"} ${message}`);
        });
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
    this.activeAccountId = account.accountId;
    this.systemMessageDispatcher = new SystemMessageDispatcher({
      queueStore: this.systemMessageQueue,
      config: this.config,
      accountId: account.accountId,
    });
    const runtimeState = await this.runtimeAdapter.initialize();
    const knownContextTokens = Object.keys(this.channelAdapter.getKnownContextTokens()).length;
    const syncBuffer = this.channelAdapter.loadSyncBuffer();
    await this.restoreBoundThreadSubscriptions();

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
    if (this.config.startWithCheckin) {
      console.log("[cyberboss] checkin: enabled");
      void runSystemCheckinPoller(this.config).catch((error) => {
        console.error(`[cyberboss] checkin poller stopped: ${error.message}`);
      });
    }

    const shutdown = createShutdownController(async () => {
      await this.runtimeAdapter.close();
    });

    try {
      let consecutiveFailures = 0;
      while (!shutdown.stopped) {
        try {
          await this.flushDueReminders(account);
          await this.flushPendingSystemMessages();
          await this.flushPendingTimelineScreenshots(account);
          const response = await this.channelAdapter.getUpdates({
            syncBuffer: this.channelAdapter.loadSyncBuffer(),
            timeoutMs: this.resolveLongPollTimeoutMs(),
          });
          assertWeixinUpdateResponse(response);
          consecutiveFailures = 0;
          const messages = Array.isArray(response?.msgs) ? response.msgs : [];
          for (const message of messages) {
            if (shutdown.stopped) {
              break;
            }
            await this.handleIncomingMessage(message);
          }
          await this.flushDueReminders(account);
          await this.flushPendingSystemMessages();
          await this.flushPendingTimelineScreenshots(account);
        } catch (error) {
          if (shutdown.stopped) {
            break;
          }

          if (isSessionExpiredError(error)) {
            throw new Error("微信会话已失效，请重新执行 `npm run login`");
          }

          consecutiveFailures += 1;
          console.error(`[cyberboss] poll failed: ${formatErrorMessage(error)}`);
          await sleep(consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS);
        }
      }
    } finally {
      shutdown.dispose();
      await this.runtimeAdapter.close();
    }
  }

  async sendTimelineScreenshot({ senderId = "", args = [], outputFile = "" } = {}) {
    const targetUserId = normalizeText(senderId) || this.resolveDefaultTerminalUser();
    if (!targetUserId) {
      throw new Error("无法确定时间轴截图要发送给哪个微信用户，先配置 CYBERBOSS_ALLOWED_USER_IDS");
    }
    const contextToken = this.channelAdapter.getKnownContextTokens()[targetUserId] || "";
    if (!contextToken) {
      throw new Error(`找不到用户 ${targetUserId} 的 context token，先让这个用户和 bot 聊过一次`);
    }

    const normalizedArgs = Array.isArray(args)
      ? args.map((value) => String(value ?? "")).filter(Boolean)
      : [];
    const resolvedOutputFile = normalizeText(outputFile) || resolveTimelineScreenshotOutput(normalizedArgs);
    const finalArgs = resolvedOutputFile
      ? normalizedArgs
      : [...normalizedArgs, "--output", path.join(os.tmpdir(), `cyberboss-timeline-${Date.now()}.png`)];
    const savedPath = resolveTimelineScreenshotOutput(finalArgs);

    await this.channelAdapter.sendTyping({
      userId: targetUserId,
      status: 1,
      contextToken,
    }).catch(() => {});
    await this.timelineIntegration.runSubcommand("screenshot", finalArgs);
    await this.channelAdapter.sendFile({
      userId: targetUserId,
      filePath: savedPath,
      contextToken,
    });
    await this.channelAdapter.sendTyping({
      userId: targetUserId,
      status: 0,
      contextToken,
    }).catch(() => {});
    return { userId: targetUserId, filePath: savedPath };
  }

  async sendLocalFileToCurrentChat({ senderId = "", filePath = "" } = {}) {
    const targetUserId = normalizeText(senderId) || this.resolveDefaultTerminalUser();
    if (!targetUserId) {
      throw new Error("无法确定文件要发送给哪个微信用户，先配置 CYBERBOSS_ALLOWED_USER_IDS");
    }

    const contextToken = this.channelAdapter.getKnownContextTokens()[targetUserId] || "";
    if (!contextToken) {
      throw new Error(`找不到用户 ${targetUserId} 的 context token，先让这个用户和 bot 聊过一次`);
    }

    const requestedPath = normalizeText(filePath);
    if (!requestedPath) {
      throw new Error("缺少要发送的文件路径");
    }
    const resolvedPath = path.resolve(requestedPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`文件不存在: ${resolvedPath}`);
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`只能发送文件，不能发送目录: ${resolvedPath}`);
    }

    await this.channelAdapter.sendTyping({
      userId: targetUserId,
      status: 1,
      contextToken,
    }).catch(() => {});
    await this.channelAdapter.sendFile({
      userId: targetUserId,
      filePath: resolvedPath,
      contextToken,
    });
    await this.channelAdapter.sendTyping({
      userId: targetUserId,
      status: 0,
      contextToken,
    }).catch(() => {});
    return { userId: targetUserId, filePath: resolvedPath };
  }

  async handleIncomingMessage(message) {
    const normalized = this.channelAdapter.normalizeIncomingMessage(message);
    if (!normalized) {
      return;
    }

    await this.handlePreparedMessage(normalized, { allowCommands: true });
  }

  resolveDefaultTerminalUser() {
    return resolvePreferredSenderId({
      config: this.config,
      accountId: this.channelAdapter.resolveAccount().accountId,
      sessionStore: this.runtimeAdapter.getSessionStore(),
    });
  }

  async handlePreparedMessage(normalized, { allowCommands }) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    this.streamDelivery.setReplyTarget(bindingKey, {
      userId: normalized.senderId,
      contextToken: normalized.contextToken,
      provider: normalized.provider,
    });

    const command = parseChannelCommand(normalized.text);
    if (allowCommands && command) {
      await this.dispatchChannelCommand(normalized, command);
      return;
    }

    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const prepared = await this.prepareIncomingMessageForRuntime(normalized, workspaceRoot);
    if (!prepared) {
      return;
    }

    await this.channelAdapter.sendTyping({
      userId: normalized.senderId,
      status: 1,
      contextToken: normalized.contextToken,
    }).catch(() => {});

    try {
      const turn = await this.runtimeAdapter.sendTextTurn({
        bindingKey,
        workspaceRoot,
        text: prepared.text,
        model: this.runtimeAdapter.getSessionStore().getCodexParamsForWorkspace(bindingKey, workspaceRoot).model,
        metadata: {
          workspaceId: prepared.workspaceId,
          accountId: prepared.accountId,
          senderId: prepared.senderId,
        },
      });
      this.streamDelivery.queueReplyTargetForThread(turn.threadId, {
        userId: prepared.senderId,
        contextToken: prepared.contextToken,
        provider: prepared.provider,
      });
      this.scheduleRuntimeEventWatchdog({
        bindingKey,
        workspaceRoot,
        normalized: prepared,
        threadId: turn.threadId,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error || "unknown error");
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `处理失败：${messageText}`,
        contextToken: normalized.contextToken,
      }).catch(() => {});
    }
  }

  scheduleRuntimeEventWatchdog({ bindingKey, workspaceRoot, normalized, threadId = "" }) {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const candidateThreadId = normalizeCommandArgument(threadId)
      || sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
    const normalizedThreadId = normalizeCommandArgument(candidateThreadId);
    if (!normalizedThreadId) {
      return;
    }

    this.clearRuntimeEventWatchdog(normalizedThreadId);
    const noticeTimer = setTimeout(async () => {
      const watchdog = this.pendingRuntimeEventWatchdogs.get(normalizedThreadId);
      if (!watchdog) {
        return;
      }
      const currentThreadState = this.threadStateStore.getThreadState(normalizedThreadId);
      if (currentThreadState?.status === "running" || currentThreadState?.turnId) {
        return;
      }
      watchdog.noticeSent = true;
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        contextToken: normalized.contextToken,
        preserveBlock: true,
        text: [
          "这条消息已经发到 bridge，但 Codex runtime 还没有返回首个事件。",
          "如果你看到 terminal 正在 reconnecting，这一轮大概率还卡在共享线程启动阶段。",
          "先不用一直空等；如果稍后连上，消息会继续往下跑。",
          `workspace: ${workspaceRoot}`,
          `thread: ${normalizedThreadId}`,
        ].join("\n"),
      }).catch(() => {});
    }, FIRST_RUNTIME_EVENT_NOTICE_TIMEOUT_MS);
    const failureTimer = setTimeout(async () => {
      this.pendingRuntimeEventWatchdogs.delete(normalizedThreadId);
      const currentThreadState = this.threadStateStore.getThreadState(normalizedThreadId);
      if (currentThreadState?.status === "running" || currentThreadState?.turnId) {
        return;
      }
      await this.channelAdapter.sendTyping({
        userId: normalized.senderId,
        status: 0,
        contextToken: normalized.contextToken,
      }).catch(() => {});
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        contextToken: normalized.contextToken,
        preserveBlock: true,
        text: [
          "这条消息已经发到 bridge，但 Codex runtime 直到现在都没有返回首个事件。",
          "如果 terminal 里的那轮 reconnecting 已经跑完 5 次，这条共享线程基本可以判定没有真正启动成功。",
          `workspace: ${workspaceRoot}`,
          `thread: ${normalizedThreadId}`,
          "优先检查：共享 app-server 是否正常、当前终端是否接在同一个 thread、runtime 是否真的开始处理这条消息。",
          "如果你正在帮用户排查，直接按这套顺序做：",
          "1. 在项目目录执行 npm run shared:status",
          "2. 如果 bridge 不在，先执行 npm run shared:start",
          "3. 再开一个终端执行 npm run shared:open",
          "4. 确认 terminal 里打开的是上面这条 thread，而不是另一条私有线程",
        ].join("\n"),
      }).catch(() => {});
    }, FIRST_RUNTIME_EVENT_FAILURE_TIMEOUT_MS);
    this.pendingRuntimeEventWatchdogs.set(normalizedThreadId, {
      noticeTimer,
      failureTimer,
      noticeSent: false,
    });
  }

  clearRuntimeEventWatchdog(threadId) {
    const normalizedThreadId = normalizeCommandArgument(threadId);
    if (!normalizedThreadId) {
      return;
    }
    const watchdog = this.pendingRuntimeEventWatchdogs.get(normalizedThreadId);
    if (!watchdog) {
      return;
    }
    clearTimeout(watchdog.noticeTimer);
    clearTimeout(watchdog.failureTimer);
    this.pendingRuntimeEventWatchdogs.delete(normalizedThreadId);
  }

  async prepareIncomingMessageForRuntime(normalized, workspaceRoot) {
    const attachments = Array.isArray(normalized.attachments) ? normalized.attachments : [];
    if (!attachments.length) {
      return {
        ...normalized,
        originalText: normalized.text,
        text: buildCodexInboundText(normalized, { saved: [], failed: [] }, this.config),
        attachments: [],
        attachmentFailures: [],
      };
    }

    const persisted = await persistIncomingWeixinAttachments({
      attachments,
      stateDir: this.config.stateDir,
      cdnBaseUrl: this.config.weixinCdnBaseUrl,
      messageId: normalized.messageId,
      receivedAt: normalized.receivedAt,
    });

    if (!persisted.saved.length && persisted.failed.length && !String(normalized.text || "").trim()) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `图片/附件接收失败：${persisted.failed.map((item) => item.reason).join("; ")}`,
        contextToken: normalized.contextToken,
        preserveBlock: true,
      }).catch(() => {});
      return null;
    }

    const codexInboundText = buildCodexInboundText(normalized, persisted, this.config);
    if (!codexInboundText) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `图片/附件接收失败：${persisted.failed.map((item) => item.reason).join("; ")}`,
        contextToken: normalized.contextToken,
        preserveBlock: true,
      }).catch(() => {});
      return null;
    }

    return {
      ...normalized,
      originalText: normalized.text,
      text: codexInboundText,
      attachments: persisted.saved,
      attachmentFailures: persisted.failed,
    };
  }

  async flushPendingSystemMessages() {
    const pendingMessages = this.systemMessageDispatcher?.drainPending() || [];
    for (const message of pendingMessages) {
      try {
        const dispatched = await this.dispatchSystemMessage(message);
        if (!dispatched) {
          this.systemMessageDispatcher.requeue(message);
        }
      } catch {
        this.systemMessageDispatcher?.requeue(message);
      }
    }
  }

  async flushPendingTimelineScreenshots(account) {
    const pendingJobs = this.timelineScreenshotQueue.drainForAccount(account.accountId);
    for (const job of pendingJobs) {
      try {
        await this.sendTimelineScreenshot({
          senderId: job.senderId,
          args: job.args,
          outputFile: job.outputFile,
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error || "unknown error");
        console.error(`[cyberboss] timeline screenshot failed job=${job.id} ${messageText}`);
        await this.channelAdapter.sendTyping({
          userId: job.senderId,
          status: 0,
        }).catch(() => {});
        await this.channelAdapter.sendText({
          userId: job.senderId,
          text: `时间轴截图失败：${messageText}`,
          preserveBlock: true,
        }).catch(() => {});
      }
    }
  }

  resolveLongPollTimeoutMs() {
    if (this.systemMessageDispatcher?.hasPending()) {
      return MIN_LONG_POLL_TIMEOUT_MS;
    }
    if (this.activeAccountId && this.timelineScreenshotQueue.hasPendingForAccount(this.activeAccountId)) {
      return MIN_LONG_POLL_TIMEOUT_MS;
    }

    const nextDueAtMs = this.reminderQueue.peekNextDueAtMs();
    if (!nextDueAtMs) {
      return DEFAULT_LONG_POLL_TIMEOUT_MS;
    }

    const remainingMs = nextDueAtMs - Date.now();
    if (remainingMs <= MIN_LONG_POLL_TIMEOUT_MS) {
      return MIN_LONG_POLL_TIMEOUT_MS;
    }
    return Math.max(MIN_LONG_POLL_TIMEOUT_MS, Math.min(DEFAULT_LONG_POLL_TIMEOUT_MS, remainingMs));
  }

  async flushDueReminders(account) {
    const dueReminders = this.reminderQueue
      .listDue(Date.now())
      .filter((reminder) => reminder.accountId === account.accountId);

    for (const reminder of dueReminders) {
      try {
        this.systemMessageQueue.enqueue({
          id: `reminder:${reminder.id}`,
          accountId: reminder.accountId,
          senderId: reminder.senderId,
          workspaceRoot: this.resolveReminderWorkspaceRoot(reminder),
          text: buildReminderSystemTrigger(reminder, this.config),
          createdAt: new Date().toISOString(),
        });
      } catch {
        this.reminderQueue.enqueue({
          ...reminder,
          dueAtMs: Date.now() + 5_000,
        });
      }
    }
  }

  resolveReminderWorkspaceRoot(reminder) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: this.config.workspaceId,
      accountId: reminder.accountId,
      senderId: reminder.senderId,
    });
    return this.runtimeAdapter.getSessionStore().getActiveWorkspaceRoot(bindingKey) || this.config.workspaceRoot;
  }

  async dispatchSystemMessage(message) {
    const prepared = this.systemMessageDispatcher?.buildPreparedMessage(message, this.channelAdapter.getKnownContextTokens()[message.senderId] || "");
    if (!prepared) {
      throw new Error("system message could not be prepared");
    }
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: prepared.workspaceId,
      accountId: prepared.accountId,
      senderId: prepared.senderId,
    });
    const workspaceRoot = prepared.workspaceRoot || this.resolveWorkspaceRoot(bindingKey);
    const threadId = this.runtimeAdapter.getSessionStore().getThreadIdForWorkspace(bindingKey, workspaceRoot);
    const threadState = threadId ? this.threadStateStore.getThreadState(threadId) : null;
    if (threadState?.status === "running" || hasRpcId(threadState?.pendingApproval?.requestId)) {
      return false;
    }
    await this.handlePreparedMessage(prepared, { allowCommands: false });
    return true;
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
    const usage = this.threadStateStore.getLatestUsage();
    const lines = [
      `workspace: ${workspaceRoot}`,
      `thread: ${threadId || "(none)"}`,
      `status: ${threadState?.status || "idle"}`,
      `model: ${this.runtimeAdapter.getSessionStore().getCodexParamsForWorkspace(bindingKey, workspaceRoot).model || "(default)"}`,
    ];
    if (usage) {
      const usageParts = [];
      if (usage.modelContextWindow > 0 && usage.lastTotalTokens > 0) {
        usageParts.push(`last ${formatCompactNumber(usage.lastTotalTokens)}/${formatCompactNumber(usage.modelContextWindow)}`);
      } else if (usage.lastTotalTokens > 0) {
        usageParts.push(`last ${formatCompactNumber(usage.lastTotalTokens)}`);
      }
      if (usage.primaryUsedPercent > 0) {
        usageParts.push(`5h ${usage.primaryUsedPercent}%`);
      }
      if (usage.secondaryUsedPercent > 0) {
        usageParts.push(`7d ${usage.secondaryUsedPercent}%`);
      }
      if (usageParts.length) {
        lines.push(`usage: ${usageParts.join(" | ")}`);
      }
    }
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
    if (!threadId || approval?.requestId == null || String(approval.requestId).trim() === "") {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "当前没有待处理的授权请求。",
        contextToken: normalized.contextToken,
      });
      return;
    }

    const decision = command.name === "no" ? "decline" : "accept";
    console.log(
      `[cyberboss] approval response requested thread=${threadId} requestId=${approval.requestId} decision=${decision} workspace=${workspaceRoot}`
    );
    await this.runtimeAdapter.respondApproval({
      requestId: approval.requestId,
      decision,
    });
    this.runtimeAdapter.getSessionStore().clearApprovalPrompt(threadId);
    console.log(
      `[cyberboss] approval response delivered thread=${threadId} requestId=${approval.requestId} decision=${decision}`
    );
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
    if (!event) {
      return;
    }
    if (event.type === "runtime.turn.completed" || event.type === "runtime.turn.failed") {
      this.runtimeAdapter.getSessionStore().clearApprovalPrompt(event.payload.threadId);
      await this.stopTypingForThread(event.payload.threadId);
      if (event.type === "runtime.turn.failed") {
        await this.sendFailureToThread(event.payload.threadId, event.payload.text || "执行失败");
      }
      return;
    }
    if (event.type !== "runtime.approval.requested") {
      return;
    }
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const linked = sessionStore.findBindingForThreadId(event.payload.threadId);
    if (!linked?.workspaceRoot) {
      return;
    }
    const allowlist = sessionStore.getApprovalCommandAllowlistForWorkspace(linked.workspaceRoot);
    const shouldAutoApprove = matchesBuiltInCommandPrefix(event.payload.commandTokens)
      || matchesCommandPrefix(event.payload.commandTokens, allowlist);
    if (!shouldAutoApprove) {
      const promptState = sessionStore.getApprovalPromptState(event.payload.threadId);
      const promptSignature = buildApprovalPromptSignature(event.payload);
      if (promptState?.signature && promptState.signature === promptSignature) {
        sessionStore.rememberApprovalPrompt(event.payload.threadId, event.payload.requestId, promptSignature);
        console.log(
          `[cyberboss] approval prompt deduped thread=${event.payload.threadId} requestId=${event.payload.requestId}`
        );
        return;
      }
      sessionStore.rememberApprovalPrompt(event.payload.threadId, event.payload.requestId, promptSignature);
      await this.sendApprovalPrompt({
        bindingKey: linked.bindingKey,
        approval: event.payload,
      }).catch((error) => {
        sessionStore.clearApprovalPrompt(event.payload.threadId);
        throw error;
      });
      return;
    }
    await this.runtimeAdapter.respondApproval({
      requestId: event.payload.requestId,
      decision: "accept",
    }).catch(() => {});
    this.threadStateStore.resolveApproval(event.payload.threadId, "running");
  }

  async stopTypingForThread(threadId) {
    const linked = this.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
    const target = linked?.bindingKey ? this.resolveReplyTargetForBinding(linked.bindingKey) : null;
    if (!target) {
      return;
    }
    await this.channelAdapter.sendTyping({
      userId: target.userId,
      status: 0,
      contextToken: target.contextToken,
    }).catch(() => {});
  }

  async sendFailureToThread(threadId, text) {
    const linked = this.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
    const target = linked?.bindingKey ? this.resolveReplyTargetForBinding(linked.bindingKey) : null;
    if (!target) {
      return;
    }
    await this.channelAdapter.sendText({
      userId: target.userId,
      text: normalizeText(text) || "执行失败",
      contextToken: target.contextToken,
    }).catch(() => {});
  }

  async sendApprovalPrompt({ bindingKey, approval }) {
    const target = this.resolveReplyTargetForBinding(bindingKey);
    if (!target) {
      console.warn(
        `[cyberboss] approval prompt skipped binding=${bindingKey} requestId=${approval?.requestId || ""} reason=no_reply_target`
      );
      return;
    }
    console.log(
      `[cyberboss] approval prompt sending binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""}`
    );
    await this.channelAdapter.sendTyping({
      userId: target.userId,
      status: 0,
      contextToken: target.contextToken,
    }).catch(() => {});
    await this.channelAdapter.sendText({
      userId: target.userId,
      text: buildApprovalPromptText(approval),
      contextToken: target.contextToken,
      preserveBlock: true,
    });
    console.log(
      `[cyberboss] approval prompt delivered binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""}`
    );
  }

  async restoreBoundThreadSubscriptions() {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const bindings = sessionStore.listBindings();
    const seenThreadIds = new Set();

    for (const binding of bindings) {
      const bindingKey = normalizeText(binding?.bindingKey);
      if (!bindingKey) {
        continue;
      }

      const target = this.resolveReplyTargetForBinding(bindingKey);
      if (target) {
        this.streamDelivery.setReplyTarget(bindingKey, target);
      }

      const threadIdByWorkspaceRoot = binding?.threadIdByWorkspaceRoot && typeof binding.threadIdByWorkspaceRoot === "object"
        ? binding.threadIdByWorkspaceRoot
        : {};
      for (const threadId of Object.values(threadIdByWorkspaceRoot)) {
        const normalizedThreadId = normalizeCommandArgument(threadId);
        if (!normalizedThreadId || seenThreadIds.has(normalizedThreadId)) {
          continue;
        }
        seenThreadIds.add(normalizedThreadId);
        await this.runtimeAdapter.resumeThread({ threadId: normalizedThreadId }).catch(() => {});
      }
    }
  }

  resolveReplyTargetForBinding(bindingKey) {
    const binding = this.runtimeAdapter.getSessionStore().getBinding(bindingKey) || null;
    const userId = normalizeCommandArgument(binding?.senderId);
    if (!userId) {
      return null;
    }
    const contextToken = this.channelAdapter.getKnownContextTokens()[userId] || "";
    if (!contextToken) {
      return null;
    }
    return {
      userId,
      contextToken,
      provider: "weixin",
    };
  }
}

function formatCompactNumber(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return "0";
  }
  if (normalized >= 1_000_000) {
    return `${Math.round(normalized / 100_000) / 10}m`;
  }
  if (normalized >= 1_000) {
    return `${Math.round(normalized / 100) / 10}k`;
  }
  return String(Math.round(normalized));
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

function assertWeixinUpdateResponse(response) {
  const ret = normalizeErrorCode(response?.ret);
  const errcode = normalizeErrorCode(response?.errcode);
  if ((ret !== 0 && ret !== null) || (errcode !== 0 && errcode !== null)) {
    const error = new Error(
      `weixin getUpdates ret=${ret ?? ""} errcode=${errcode ?? ""} errmsg=${normalizeText(response?.errmsg) || ""}`
    );
    error.ret = ret;
    error.errcode = errcode;
    throw error;
  }
}

function isSessionExpiredError(error) {
  const ret = normalizeErrorCode(error?.ret);
  const errcode = normalizeErrorCode(error?.errcode);
  return ret === SESSION_EXPIRED_ERRCODE
    || errcode === SESSION_EXPIRED_ERRCODE
    || String(error?.message || "").includes("session expired")
    || String(error?.message || "").includes("会话已失效");
}

function normalizeErrorCode(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error || "unknown error");
  if (isSessionExpiredError(error)) {
    return "微信会话已失效，请重新执行 `npm run login`";
  }
  return raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:\//;
const WINDOWS_DRIVE_ROOT_RE = /^[A-Za-z]:\/$/;
const WINDOWS_UNC_PREFIX_RE = /^\/\/\?\//;

function normalizeWorkspacePath(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  const fromFileUri = extractPathFromFileUri(normalized);
  const rawPath = fromFileUri || normalized;
  const withForwardSlashes = rawPath.replace(/\\/g, "/").replace(WINDOWS_UNC_PREFIX_RE, "");
  const normalizedDrivePrefix = /^\/[A-Za-z]:\//.test(withForwardSlashes)
    ? withForwardSlashes.slice(1)
    : withForwardSlashes;

  if (WINDOWS_DRIVE_ROOT_RE.test(normalizedDrivePrefix)) {
    return normalizedDrivePrefix;
  }
  if (WINDOWS_DRIVE_PATH_RE.test(normalizedDrivePrefix)) {
    return normalizedDrivePrefix.replace(/\/+$/g, "");
  }
  return normalizedDrivePrefix.replace(/\/+$/g, "");
}

function isAbsoluteWorkspacePath(value) {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) {
    return false;
  }
  if (WINDOWS_DRIVE_PATH_RE.test(normalized)) {
    return true;
  }
  return path.posix.isAbsolute(normalized);
}

function extractPathFromFileUri(value) {
  const input = String(value || "").trim();
  if (!/^file:\/\//i.test(input)) {
    return "";
  }

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "file:") {
      return "";
    }
    const pathname = decodeURIComponent(parsed.pathname || "");
    const withHost = parsed.host && parsed.host !== "localhost"
      ? `//${parsed.host}${pathname}`
      : pathname;
    return withHost;
  } catch {
    return "";
  }
}

function normalizeCommandArgument(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
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

function matchesBuiltInCommandPrefix(commandTokens) {
  const normalized = normalizeCommandTokensForMatching(commandTokens);
  if (!normalized.length) {
    return false;
  }

  if (normalized[0] === "npm") {
    const runIndex = normalized.indexOf("run");
    if (runIndex >= 0) {
      const scriptName = normalizeCommandArgument(normalized[runIndex + 1]);
      return isBuiltInScriptName(scriptName);
    }
  }

  const executable = path.basename(normalized[0] || "");
  if ((executable === "sh" || executable === "bash" || executable === "zsh")
    && matchesBuiltInShellScript(normalized[1])) {
    return true;
  }
  if (executable === "node" || executable === "node.exe") {
    const binPath = normalizeCommandArgument(normalized[1]);
    if (binPath === "./bin/cyberboss.js" || binPath.endsWith("/bin/cyberboss.js")) {
      return matchesBuiltInCliCommand(normalized.slice(2));
    }
  }

  if (executable === "cyberboss" || executable === "cyberboss.js") {
    return matchesBuiltInCliCommand(normalized.slice(1));
  }

  return false;
}

function normalizeCommandTokensForMatching(commandTokens) {
  const normalized = Array.isArray(commandTokens)
    ? commandTokens.map((part) => normalizeCommandArgument(part)).filter(Boolean)
    : [];
  if (normalized.length >= 3 && isShellWrapper(normalized[0], normalized[1])) {
    return splitCommandLine(normalized.slice(2).join(" "));
  }
  return normalized;
}

function isShellWrapper(command, flag) {
  const executable = path.basename(normalizeCommandArgument(command));
  return (executable === "sh" || executable === "bash" || executable === "zsh") && flag === "-lc";
}

function isBuiltInScriptName(scriptName) {
  return scriptName === "reminder:write"
    || scriptName === "diary:write"
    || scriptName.startsWith("timeline:");
}

function matchesBuiltInShellScript(scriptPath) {
  const basename = path.basename(normalizeCommandArgument(scriptPath));
  return basename === "timeline-screenshot.sh";
}

function matchesBuiltInCliCommand(tokens) {
  if (!Array.isArray(tokens) || tokens.length < 2) {
    return false;
  }
  const topic = normalizeCommandArgument(tokens[0]);
  const action = normalizeCommandArgument(tokens[1]);
  if (topic === "timeline") {
    return action === "write"
      || action === "build"
      || action === "serve"
      || action === "dev"
      || action === "screenshot"
      || action === "read"
      || action === "categories"
      || action === "proposals";
  }
  return (topic === "reminder" && action === "write")
    || (topic === "diary" && action === "write")
    || false;
}

function splitCommandLine(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of String(input || "")) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function buildApprovalPromptText(approval) {
  const reasonText = normalizeText(approval?.reason);
  const commandText = normalizeText(approval?.command);
  const sections = ["Codex 请求授权"];

  if (reasonText && reasonText !== commandText) {
    sections.push(`操作说明：\n${reasonText}`);
  }

  if (commandText) {
    sections.push(`待执行命令：\n${commandText}`);
  } else if (!reasonText) {
    sections.push("(unknown)");
  }

  sections.push([
    "回复以下命令继续：",
    "/yes  本次允许",
    "/always  本项目后续同前缀自动允许",
    "/no  拒绝本次请求",
  ].join("\n"));

  return sections.join("\n\n");
}

function buildApprovalPromptSignature(approval) {
  const reasonText = normalizeText(approval?.reason);
  const commandText = normalizeText(approval?.command);
  const commandTokens = Array.isArray(approval?.commandTokens)
    ? approval.commandTokens.map((token) => normalizeCommandArgument(token)).filter(Boolean)
    : [];
  return JSON.stringify({
    reason: reasonText,
    command: commandText,
    commandTokens,
  });
}

function buildReminderSystemTrigger(reminder, config = {}) {
  const reminderText = String(reminder?.text || "").trim();
  const userName = String(config?.userName || "").trim() || "用户";
  return [
    "A scheduled reminder is due.",
    `Send ${userName} one short and natural WeChat message.`,
    "Do not mention internal triggers.",
    "Do not mechanically repeat the reminder text.",
    `Reminder: ${reminderText}`,
  ].join("\n");
}

function buildCodexInboundText(normalized, persisted = {}, config = {}) {
  const text = String(normalized?.text || "").trim();
  const saved = Array.isArray(persisted?.saved) ? persisted.saved : [];
  const failed = Array.isArray(persisted?.failed) ? persisted.failed : [];
  const userName = String(config?.userName || "").trim() || "用户";
  const localTime = formatWechatLocalTime(normalized?.receivedAt);
  const lines = [];
  if (localTime) {
    lines.push(`[${localTime}]`);
  }
  if (text) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(text);
  }

  if (saved.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(`${userName} sent image/file attachments. They were saved under the local data directory:`);
    for (const item of saved) {
      const suffix = item.sourceFileName ? ` (original name: ${item.sourceFileName})` : "";
      lines.push(`- [${item.kind}] ${item.absolutePath}${suffix}`);
    }
    lines.push(`You must read these files before replying to ${userName}. Do not skip the read step.`);
    lines.push(`If the required local tool is missing, tell ${userName} exactly what is missing and that you cannot read the file yet. Do not pretend you already read it.`);
  }

  if (failed.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push("Attachment intake errors:");
    for (const item of failed) {
      const label = item.sourceFileName || item.kind || "attachment";
      lines.push(`- ${label}: ${item.reason}`);
    }
  }

  return lines.join("\n").trim();
}

function formatWechatLocalTime(receivedAt) {
  const value = typeof receivedAt === "string" ? receivedAt.trim() : "";
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed).replace(/\//g, "-");
}

function stringifyRpcId(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function hasRpcId(value) {
  return stringifyRpcId(value) !== "";
}

function resolveTimelineScreenshotOutput(args) {
  const normalizedArgs = Array.isArray(args) ? args : [];
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    if (String(normalizedArgs[index] || "").trim() !== "--output") {
      continue;
    }
    return String(normalizedArgs[index + 1] || "").trim();
  }
  return "";
}
