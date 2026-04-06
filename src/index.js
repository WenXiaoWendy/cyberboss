const fs = require("fs");
const os = require("os");
const path = require("path");
const dotenv = require("dotenv");

const { readConfig } = require("./core/config");
const { CyberbossApp } = require("./core/app");
const { runDiaryWriteCommand } = require("./app/diary-write-cli");
const { runReminderWriteCommand } = require("./app/reminder-write-cli");
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

function printHelp() {
  console.log(buildTerminalHelpText());
}

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);
  const config = readConfig();
  const command = config.mode || "help";
  const subcommand = argv[1] || "";

  if (command === "help" || command === "--help" || command === "-h") {
    const topicHelp = subcommand ? buildTerminalTopicHelp(subcommand) : "";
    console.log(topicHelp || buildTerminalHelpText());
    return;
  }

  if (isPlannedTerminalTopic(command)) {
    const topicHelp = buildTerminalTopicHelp(command);
    if (subcommand === "help" || !subcommand) {
      console.log(topicHelp);
      return;
    }
    if (command === "diary" && subcommand === "write") {
      await runDiaryWriteCommand(config);
      return;
    }
    if (command === "reminder" && subcommand === "write") {
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
  }

  const app = new CyberbossApp(config);

  if (command === "timeline") {
    if (!subcommand || subcommand === "help") {
      console.log(buildTerminalTopicHelp("timeline"));
      return;
    }
    await app.timelineIntegration.runSubcommand(subcommand, argv.slice(2));
    return;
  }

  if (command === "doctor") {
    app.printDoctor();
    return;
  }

  if (command === "login") {
    await app.login();
    return;
  }

  if (command === "accounts") {
    app.printAccounts();
    return;
  }

  if (command === "start") {
    await app.start();
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

module.exports = { main };
