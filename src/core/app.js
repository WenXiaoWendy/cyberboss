const { createWeixinChannelAdapter } = require("../adapters/channel/weixin");
const { createCodexRuntimeAdapter } = require("../adapters/runtime/codex");
const { createTimelineIntegration } = require("../integrations/timeline");

class CyberbossApp {
  constructor(config) {
    this.config = config;
    this.channelAdapter = createWeixinChannelAdapter(config);
    this.runtimeAdapter = createCodexRuntimeAdapter(config);
    this.timelineIntegration = createTimelineIntegration(config);
  }

  printDoctor() {
    console.log(JSON.stringify({
      stateDir: this.config.stateDir,
      channel: this.channelAdapter.describe(),
      runtime: this.runtimeAdapter.describe(),
      timeline: this.timelineIntegration.describe(),
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

    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });

    await this.channelAdapter.sendTyping({
      userId: normalized.senderId,
      status: 1,
      contextToken: normalized.contextToken,
    }).catch(() => {});

    try {
      const result = await this.runtimeAdapter.sendTextTurn({
        bindingKey,
        workspaceRoot: this.config.workspaceRoot,
        text: normalized.text,
        metadata: {
          workspaceId: normalized.workspaceId,
          accountId: normalized.accountId,
          senderId: normalized.senderId,
        },
      });
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: result.text,
        contextToken: normalized.contextToken,
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
