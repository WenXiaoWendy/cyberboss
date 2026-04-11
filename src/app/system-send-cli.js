const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { loadPersistedContextTokens } = require("../adapters/channel/weixin/context-token-store");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } = require("../core/default-targets");
const { SystemMessageQueueStore } = require("../core/system-message-queue-store");

async function runSystemSendCommand(config) {
  const options = parseSystemSendArgs(process.argv.slice(4));
  if (options.help) {
    printSystemSendHelp();
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
  const text = options.text;
  const workspaceRoot = resolvePreferredWorkspaceRoot({
    config,
    accountId: account.accountId,
    senderId,
    explicitWorkspace: options.workspace,
    sessionStore,
  });
  if (!senderId || !text || !workspaceRoot) {
    printSystemSendHelp();
    throw new Error("system send is missing required arguments");
  }
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error(`workspace must be an absolute path: ${workspaceRoot}`);
  }

  let workspaceStats = null;
  try {
    workspaceStats = fs.statSync(workspaceRoot);
  } catch {
    throw new Error(`workspace does not exist: ${workspaceRoot}`);
  }
  if (!workspaceStats.isDirectory()) {
    throw new Error(`workspace is not a directory: ${workspaceRoot}`);
  }

  const contextTokens = loadPersistedContextTokens(config, account.accountId);
  if (!contextTokens[senderId]) {
    throw new Error(`Cannot find a context token for user ${senderId}. Let this user talk to the bot once first.`);
  }
  const queue = new SystemMessageQueueStore({ filePath: config.systemMessageQueueFile });
  const queued = queue.enqueue({
    id: crypto.randomUUID(),
    accountId: account.accountId,
    senderId,
    workspaceRoot,
    text,
    createdAt: new Date().toISOString(),
  });

  console.log(`system message queued: ${queued.id}`);
  console.log(`user: ${queued.senderId}`);
  console.log(`workspace: ${queued.workspaceRoot}`);
}

function parseSystemSendArgs(args) {
  const options = {
    help: false,
    user: "",
    text: "",
    workspace: "",
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

    if (!token.startsWith("--")) {
      throw new Error(`Unknown argument: ${token}`);
    }

    const key = token.slice(2);
    const value = String(args[index + 1] || "");
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for argument: ${token}`);
    }

    if (key === "user") {
      options.user = value.trim();
    } else if (key === "text") {
      options.text = value.trim();
    } else if (key === "workspace") {
      options.workspace = value.trim();
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }

    index += 1;
  }

  return options;
}

function printSystemSendHelp() {
  console.log(`
Usage: npm run system:send -- --text "<message>" [--user <wechat_user_id>] [--workspace /absolute/path]

Example:
  npm run system:send -- --text "Remind her to sleep earlier tonight" --workspace "$(pwd)"
`);
}

function normalizeWorkspacePath(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { runSystemSendCommand };
