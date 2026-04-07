const crypto = require("crypto");
const path = require("path");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { resolvePreferredSenderId } = require("../core/default-targets");
const { TimelineScreenshotQueueStore } = require("../core/timeline-screenshot-queue-store");

async function runTimelineScreenshotCommand(config, args = process.argv.slice(4)) {
  const options = parseTimelineScreenshotArgs(args);
  if (options.help) {
    printTimelineScreenshotHelp();
    return;
  }

  const account = resolveSelectedAccount(config);
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const senderId = resolvePreferredSenderId({
    config,
    accountId: account.accountId,
    explicitUser: options.user,
    sessionStore,
  });

  if (!senderId) {
    throw new Error("缺少发送目标，传 --user 或配置 CYBERBOSS_ALLOWED_USER_IDS");
  }

  const queue = new TimelineScreenshotQueueStore({ filePath: config.timelineScreenshotQueueFile });
  const queued = queue.enqueue({
    id: crypto.randomUUID(),
    accountId: account.accountId,
    senderId,
    outputFile: options.outputFile,
    args: options.forwardArgs,
    createdAt: new Date().toISOString(),
  });

  console.log(`timeline screenshot queued: ${queued.id}`);
  console.log(`user: ${queued.senderId}`);
}

function parseTimelineScreenshotArgs(args) {
  const options = {
    help: false,
    user: "",
    outputFile: "",
    forwardArgs: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "").trim();
    if (!token) {
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--user") {
      const value = String(args[index + 1] || "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("参数缺少值: --user");
      }
      options.user = value;
      index += 1;
      continue;
    }
    if (token === "--output") {
      const value = String(args[index + 1] || "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("参数缺少值: --output");
      }
      options.outputFile = path.resolve(value);
      index += 1;
      continue;
    }

    options.forwardArgs.push(token);
    const next = String(args[index + 1] || "").trim();
    if (token.startsWith("--") && next && !next.startsWith("--")) {
      options.forwardArgs.push(next);
      index += 1;
    }
  }

  return options;
}

function printTimelineScreenshotHelp() {
  console.log(`
用法: sh "$CYBERBOSS_HOME/scripts/timeline-screenshot.sh" --send [--user <wechatUserId>] [--output /绝对路径] [其他 timeline screenshot 参数]

说明:
  这条命令只负责把截图任务排进本地队列，真正截图由正在运行的微信 bridge 执行。

示例:
  sh "$CYBERBOSS_HOME/scripts/timeline-screenshot.sh" --send --selector timeline
`);
}

module.exports = {
  runTimelineScreenshotCommand,
  parseTimelineScreenshotArgs,
};
