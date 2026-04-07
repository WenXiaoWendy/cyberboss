const fs = require("fs");
const os = require("os");
const path = require("path");
const dotenv = require("dotenv");

const { readConfig } = require("./core/config");
const { CyberbossApp } = require("./core/app");
const { createTimelineIntegration } = require("./integrations/timeline");
const { runDiaryWriteCommand } = require("./app/diary-write-cli");
const { runReminderWriteCommand } = require("./app/reminder-write-cli");
const { runChannelSendFileCommand } = require("./app/channel-send-file-cli");
const { runTimelineScreenshotCommand } = require("./app/timeline-screenshot-cli");
const { runSystemCheckinPoller } = require("./app/system-checkin-poller");
const { runSystemSendCommand } = require("./app/system-send-cli");
const {
  buildTerminalHelpText,
  buildTerminalTopicHelp,
  isPlannedTerminalTopic,
} = require("./core/command-registry");

function ensureDefaultStateDirectory() {
  fs.mkdirSync(path.join(os.homedir(), ".cyberboss"), { recursive: true });
}

function loadEnv() {
  ensureDefaultStateDirectory();
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), ".cyberboss", ".env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    dotenv.config({ path: envPath });
    return;
  }
  dotenv.config();
}

function ensureRuntimeEnv() {
  if (!process.env.CYBERBOSS_HOME) {
    process.env.CYBERBOSS_HOME = path.resolve(__dirname, "..");
  }
}

function printHelp() {
  console.log(buildTerminalHelpText());
}

let runtimeErrorHooksInstalled = false;

function installRuntimeErrorHooks() {
  if (runtimeErrorHooksInstalled) {
    return;
  }
  runtimeErrorHooksInstalled = true;

  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error(`[cyberboss] unhandled rejection ${message}`);
  });

  process.on("uncaughtException", (error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[cyberboss] uncaught exception ${message}`);
    process.exitCode = 1;
  });
}

async function main() {
  loadEnv();
  ensureRuntimeEnv();
  installRuntimeErrorHooks();
  const argv = process.argv.slice(2);
  const config = readConfig();
  const command = config.mode || "help";
  const subcommand = argv[1] || "";
  let app = null;
  const getApp = () => {
    if (!app) {
      app = new CyberbossApp(config);
    }
    return app;
  };

  if (command === "help" || command === "--help" || command === "-h") {
    const topicHelp = subcommand ? buildTerminalTopicHelp(subcommand) : "";
    console.log(topicHelp || buildTerminalHelpText());
    return;
  }

  if (isPlannedTerminalTopic(command)) {
    const topicHelp = buildTerminalTopicHelp(command);
    const subcommandArgs = argv.slice(2);
    const wantsSubcommandHelp = subcommandArgs.includes("--help") || subcommandArgs.includes("-h");
    if (subcommand === "help" || !subcommand) {
      console.log(topicHelp);
      return;
    }
    if (command === "diary" && subcommand === "write") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      await runDiaryWriteCommand(config);
      return;
    }
    if (command === "reminder" && subcommand === "write") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      await runReminderWriteCommand(config);
      return;
    }
    if (command === "system" && subcommand === "send") {
      await runSystemSendCommand(config);
      return;
    }
    if (command === "system" && subcommand === "checkin-poller") {
      await runSystemCheckinPoller(config);
      return;
    }
    if (command === "channel" && subcommand === "send-file") {
      await runChannelSendFileCommand(getApp());
      return;
    }
  }

  if (command === "timeline") {
    const timelineIntegration = createTimelineIntegration(config);
    if (!subcommand || subcommand === "help") {
      console.log(buildTerminalTopicHelp("timeline"));
      return;
    }
    if (subcommand === "screenshot") {
      const screenshotArgs = argv.slice(2);
      if (screenshotArgs.includes("--help") || screenshotArgs.includes("-h")) {
        await timelineIntegration.runSubcommand(subcommand, screenshotArgs);
        return;
      }
      await runTimelineScreenshotCommand(config, argv.slice(2));
      return;
    }
    await timelineIntegration.runSubcommand(subcommand, argv.slice(2));
    return;
  }

  if (command === "doctor") {
    getApp().printDoctor();
    return;
  }

  if (command === "login") {
    await getApp().login();
    return;
  }

  if (command === "accounts") {
    getApp().printAccounts();
    return;
  }

  if (command === "start") {
    await getApp().start();
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

module.exports = { main };
