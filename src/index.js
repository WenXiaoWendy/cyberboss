const fs = require("fs");
const os = require("os");
const path = require("path");
const dotenv = require("dotenv");

const { readConfig } = require("./core/config");
const { renderInstructionTemplate } = require("./core/instructions-template");
const { CyberbossApp } = require("./core/app");
const { runSystemCheckinPoller } = require("./app/system-checkin-poller");
const { buildTerminalHelpText } = require("./core/command-registry");
const { ensureStickerCatalogFilesSync } = require("./services/sticker-service");
const { createProjectTooling } = require("./tools/create-project-tooling");
const { runToolMcpServer } = require("./tools/mcp-stdio-server");

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

function ensureBootstrapFiles(config) {
  ensureInstructionsTemplate(config);
  ensureStickerCatalogFilesSync(config);
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

/**
 * 写 PID 文件前，检查旧 PID 是否对应一个仍活着、且不是当前进程父进程的进程。
 * 满足条件才杀，避免误杀 shared-start.js 或无关进程。
 */
function killStalePidIfSafe(pidFile) {
  let oldPid;
  try {
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    oldPid = parseInt(raw, 10);
  } catch {
    return; // 文件不存在或读取失败，正常情况
  }

  if (!oldPid || isNaN(oldPid)) {
    return;
  }

  if (oldPid === process.pid) {
    console.warn(`[cyberboss] WARN: old claude PID matches current process PID. Skipping taskkill to prevent suicide.`);
    return;
  }

  // 安全检查1：不杀父进程（shared-start.js 就是父进程）
  if (oldPid === process.ppid) {
    console.log(`[cyberboss] PID 文件中的旧 PID ${oldPid} 是当前父进程，跳过`);
    return;
  }

  // 安全检查2：确认进程确实还活着（发送信号0探测，不实际kill）
  let alive = false;
  try {
    // Windows 上 process.kill(pid, 0) 能探测进程是否存在
    process.kill(oldPid, 0);
    alive = true;
  } catch (e) {
    // Windows: 对非父子进程抛 EPERM 表示进程存在，ESRCH 表示进程已死
    alive = e.code === "EPERM";
  }

  if (!alive) {
    return; // 旧进程已死，直接覆写 PID 文件即可
  }

  // 两个检查都通过，旧进程还活着且不是父进程，杀掉
  console.log(`[cyberboss] 发现残留主进程 PID ${oldPid}，正在清理...`);
  try {
    const { execFileSync } = require("child_process");
    execFileSync("taskkill", ["/F", "/T", "/PID", String(oldPid)], { stdio: "ignore" });
    console.log(`[cyberboss] 已清理残留进程 PID ${oldPid}`);
  } catch (e) {
    // 杀失败不崩，继续启动
    console.warn(`[cyberboss] 清理残留进程 ${oldPid} 失败: ${e.message}`);
  }
}

let runtimeErrorHooksInstalled = false;

function installRuntimeErrorHooks() {
  if (runtimeErrorHooksInstalled) {
    return;
  }
  runtimeErrorHooksInstalled = true;

  const crashLogPath = path.join(os.homedir(), ".cyberboss", "crash.log");

  process.on("unhandledRejection", (reason, promise) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    const fullMessage = `unhandledRejection: ${message}`;
    console.error(`[cyberboss] FATAL ${fullMessage}`);
    try {
      fs.appendFileSync(crashLogPath, `[${new Date().toISOString()}] ${fullMessage}\n`);
      fs.appendFileSync(crashLogPath, `  reason: ${JSON.stringify(String(reason))}\n`);
    } catch {}
    process.stderr.write(`[cyberboss] FATAL ${fullMessage}\n`);
    setTimeout(() => process.exit(1), 100);
  });

  process.on("uncaughtException", (error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    const fullMessage = `uncaughtException: ${message}`;
    console.error(`[cyberboss] FATAL ${fullMessage}`);
    try {
      fs.appendFileSync(crashLogPath, `[${new Date().toISOString()}] ${fullMessage}\n`);
    } catch {}
    process.stderr.write(`[cyberboss] FATAL ${fullMessage}\n`);
    setTimeout(() => process.exit(1), 100);
  });
}

async function main() {
  loadEnv();
  ensureRuntimeEnv();
  installRuntimeErrorHooks();

  ensureDefaultStateDirectory();

  const argv = process.argv.slice(2);
  const config = readConfig();
  ensureBootstrapFiles(config);
  const command = config.mode || "help";
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
    await getApp().login();
    return;
  }

  if (command === "accounts") {
    getApp().printAccounts();
    return;
  }

  if (command === "start") {
    const pidFile = path.join(os.homedir(), ".cyberboss", "cyberboss.pid");
    killStalePidIfSafe(pidFile);
    fs.writeFileSync(pidFile, String(process.pid));
    process.on("exit", () => {
      try { fs.unlinkSync(pidFile); } catch {}
    });
    await getApp().start();
    return;
  }

  if (command === "tool-mcp-server") {
    const runtimeId = readFlagValue(argv.slice(1), "--runtime-id") || "";
    const workspaceRoot = readFlagValue(argv.slice(1), "--workspace-root") || process.cwd();
    const { toolHost } = createProjectTooling(config);
    runToolMcpServer({ toolHost, runtimeId, workspaceRoot });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

module.exports = { main, killStalePidIfSafe };

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
