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
    throw new Error("Missing send target. Pass --user or configure CYBERBOSS_ALLOWED_USER_IDS.");
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
    if (token === "--send") {
      continue;
    }
    if (token === "--demo") {
      continue;
    }
    if (token === "--user") {
      const value = String(args[index + 1] || "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for argument: --user");
      }
      options.user = value;
      index += 1;
      continue;
    }
    if (token === "--output") {
      const value = String(args[index + 1] || "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for argument: --output");
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
Usage: cyberboss timeline screenshot --send [--user <wechatUserId>] [--output /absolute/path] [other timeline screenshot args]

Notes:
  This command only queues the screenshot job locally. The actual screenshot is taken by the running WeChat bridge.

Example:
  cyberboss timeline screenshot --send --selector timeline --locale en
`);
}

module.exports = {
  runTimelineScreenshotCommand,
  parseTimelineScreenshotArgs,
};
