const fs = require("fs");
const os = require("os");
const path = require("path");
const dotenv = require("dotenv");

const { readConfig } = require("./core/config");
const { CyberbossApp } = require("./core/app");
const { buildTerminalHelpText } = require("./core/command-registry");

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
  const config = readConfig();
  const command = config.mode || "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const app = new CyberbossApp(config);

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
