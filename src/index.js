const fs = require("fs");
const path = require("path");

const { readConfig } = require("./core/config");
const { createWeixinChannelAdapter } = require("./adapters/channel/weixin");
const { applyCyberbossEnv, resolveCyberbossEnv } = require("./core/env-loader");
const {
  assertSafeBetaStartAllowed,
  isSafeBetaEnabled,
  validateMemoryMcpPaths,
} = require("./core/safe-beta");
const { assertSafeBetaStateDir } = require("./core/state-dir-preflight");
const { renderInstructionTemplate } = require("./core/instructions-template");
const { CyberbossApp } = require("./core/app");
const { runSystemCheckinPoller } = require("./app/system-checkin-poller");
const { buildTerminalHelpText } = require("./core/command-registry");
const { ensureStickerCatalogFilesSync } = require("./services/sticker-service");
const { createProjectTooling } = require("./tools/create-project-tooling");
const { runToolMcpServer } = require("./tools/mcp-stdio-server");

function loadEnv() {
  return applyCyberbossEnv();
}

function ensureRuntimeEnv() {
  if (!process.env.CYBERBOSS_HOME) {
    process.env.CYBERBOSS_HOME = path.resolve(__dirname, "..");
  }
}

function ensureBootstrapFiles(config) {
  ensureInstructionsTemplate(config);
  if (!config.safeBeta) {
    ensureStickerCatalogFilesSync(config);
  }
}

function ensureInstructionsTemplate(config) {
  const filePath = typeof config?.weixinInstructionsFile === "string"
    ? config.weixinInstructionsFile.trim()
    : "";
  if (!filePath || fs.existsSync(filePath)) {
    return;
  }

  const templatePath = path.resolve(__dirname, "..", "templates", "weixin-instructions.md");
  let template = "";
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch {
    return;
  }

  const userName = String(config?.userName || "").trim() || "User";
  const content = renderInstructionTemplate(template, {
    ...config,
    userName,
  }).trimEnd() + "\n";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
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
  const inheritedStateDir = process.env.CYBERBOSS_STATE_DIR;
  const envResolution = resolveCyberbossEnv();
  loadEnv();
  ensureRuntimeEnv();
  installRuntimeErrorHooks();
  const argv = process.argv.slice(2);
  const config = readConfig();
  const command = config.mode || "help";
  assertSafeBetaStateDir({
    safeBeta: isSafeBetaEnabled(process.env.CYBERBOSS_SAFE_BETA),
    mode: command,
    stateDir: config.stateDir,
    defaultStateDir: envResolution.defaultStateDir,
    stateEnvLoaded: envResolution.stateEnvLoaded,
    inheritedStateDir,
    requireInherited: true,
  });
  if (argv.includes("--state-dir-preflight-only")) {
    console.log("[cyberboss] state directory preflight passed.");
    return;
  }
  let app = null;
  const getApp = () => {
    if (!app) {
      app = new CyberbossApp(config);
    }
    return app;
  };

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(buildTerminalHelpText());
    return;
  }

  if (command === "doctor") {
    getApp().printDoctor();
    return;
  }

  if (command === "login") {
    ensureBootstrapFiles(config);
    if (config.safeBeta) {
      await createWeixinChannelAdapter(config).login();
    } else {
      await getApp().login();
    }
    return;
  }

  if (command === "accounts") {
    getApp().printAccounts();
    return;
  }

  if (command === "start") {
    assertSafeBetaStartAllowed(config);
    if (config.safeBeta) {
      validateMemoryMcpPaths({
        pythonPath: config.memoryPythonPath,
        memoryAgentRoot: config.memoryAgentRoot,
        databasePath: config.memoryDatabasePath,
      });
    }
    ensureBootstrapFiles(config);
    await getApp().start();
    return;
  }

  if (command === "tool-mcp-server") {
    if (config.safeBeta) {
      throw new Error("Safe Beta refuses to start cyberboss_tools.");
    }
    const runtimeId = readFlagValue(argv.slice(1), "--runtime-id") || "";
    const workspaceRoot = readFlagValue(argv.slice(1), "--workspace-root") || process.cwd();
    const { toolHost } = createProjectTooling(config);
    runToolMcpServer({ toolHost, runtimeId, workspaceRoot });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

module.exports = { main };

function readFlagValue(args, flag) {
  if (!Array.isArray(args)) {
    return "";
  }
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      return String(args[index + 1] || "").trim();
    }
  }
  return "";
}
