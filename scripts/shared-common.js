const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  buildCodexMcpConfigArgs,
  resolveCodexProjectToolMcpServerConfig,
} = require("../src/adapters/runtime/codex/mcp-config");

try {
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
} catch {
  // ignore
}

try {
  require("dotenv").config({ path: path.join(os.homedir(), ".cyberboss", ".env") });
} catch {
  // ignore
}

const rootDir = path.resolve(__dirname, "..");
const port = String(process.env.CYBERBOSS_SHARED_PORT || "8765");
const listenUrl = `ws://127.0.0.1:${port}`;
const stateDir = process.env.CYBERBOSS_STATE_DIR || path.join(os.homedir(), ".cyberboss");
const logDir = path.join(stateDir, "logs");
const appServerPidFile = path.join(logDir, "shared-app-server.pid");
const bridgePidFile = path.join(logDir, "shared-wechat.pid");
const appServerLogFile = path.join(logDir, "shared-app-server.log");
const accountsDir = path.join(stateDir, "accounts");
const sessionFile = process.env.CYBERBOSS_SESSIONS_FILE || path.join(stateDir, "sessions.json");

function ensureLogDir() {
  fs.mkdirSync(logDir, { recursive: true });
}

function isPidAlive(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return false;
  }
  if (process.platform === "win32") {
    try {
      const result = require("child_process").execSync(
        `tasklist /FI "PID eq ${numeric}" /NH`,
        { encoding: "utf8", timeout: 3000, windowsHide: true }
      );
      return result.includes(String(numeric));
    } catch {
      return false;
    }
  }
  try {
    process.kill(numeric, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    return raw ? Number.parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function writePidFile(filePath, pid) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${pid}\n`, "utf8");
}

function removePidFileIfMatches(filePath, pid) {
  const current = readPidFile(filePath);
  if (current && current === pid) {
    fs.rmSync(filePath, { force: true });
  }
}

function checkReadyz() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: Number(port),
        path: "/readyz",
        timeout: 500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForReadyz({ attempts = 10, delayMs = 300 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    if (await checkReadyz()) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

function openLogFile(filePath) {
  return fs.openSync(filePath, "a");
}

function spawnDetachedCommand(command, args, { logFile, cwd = rootDir, env = {} } = {}) {
  const stdoutFd = openLogFile(logFile);
  const stderrFd = openLogFile(logFile);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    shell: process.platform === "win32",
  });
  child.unref();
  return child.pid;
}

async function ensureSharedAppServer() {
  if (process.env.CYBERBOSS_RUNTIME && process.env.CYBERBOSS_RUNTIME !== "codex") {
    return { pid: 0, status: "skipped" };
  }

  ensureLogDir();
  const pidFromFile = readPidFile(appServerPidFile);
  if (pidFromFile && isPidAlive(pidFromFile) && (await checkReadyz())) {
    return { pid: pidFromFile, status: "already_running" };
  }

  if (await checkReadyz()) {
    return { pid: pidFromFile || 0, status: "already_running_unknown_pid" };
  }

  const env = {
    CYBERBOSS_STATE_DIR: stateDir,
    TIMELINE_FOR_AGENT_STATE_DIR: stateDir,
  };
  if (!process.env.TIMELINE_FOR_AGENT_CHROME_PATH) {
    env.TIMELINE_FOR_AGENT_CHROME_PATH =
      process.env.CYBERBOSS_SCREENSHOT_CHROME_PATH
      || (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "");
  }

  const command = process.env.CYBERBOSS_CODEX_COMMAND || "codex";
  const mcpConfigArgs = buildCodexMcpConfigArgs(resolveCodexProjectToolMcpServerConfig({
    cyberbossHome: process.env.CYBERBOSS_HOME || rootDir,
  }));
  const pid = spawnDetachedCommand(command, [...mcpConfigArgs, "app-server", "--listen", listenUrl], {
    logFile: appServerLogFile,
    env,
  });
  writePidFile(appServerPidFile, pid);

  const ready = await waitForReadyz();
  if (!ready) {
    throw new Error(`failed to start shared app-server; check ${appServerLogFile}`);
  }

  writePidFile(appServerPidFile, pid);
  return { pid, status: "started" };
}

function findRunningCyberbossPids() {
  const pids = new Set();
  try {
    const result = require("child_process").execSync(
      `tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH`,
      { encoding: "utf8", timeout: 5000, windowsHide: true }
    );
    for (const line of result.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(",");
      if (parts.length < 2) continue;
      const pid = Number.parseInt(parts[1].replace(/"/g, ""), 10);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      pids.add(pid);
    }
  } catch {
    // ignore - won't detect orphans, PID file guard still applies
  }
  const cyberbossPids = [];
  for (const pid of pids) {
    try {
      const cmdline = require("child_process").execSync(
        `wmic process where ProcessId=${pid} get CommandLine /VALUE`,
        { encoding: "utf8", timeout: 3000, windowsHide: true }
      );
      if (cmdline.includes("cyberboss.js")) {
        cyberbossPids.push(pid);
      }
    } catch {
      // skip this pid
    }
  }
  return cyberbossPids;
}

function ensureBridgeNotRunning() {
  const pidFromFile = readPidFile(bridgePidFile);
  if (pidFromFile && isPidAlive(pidFromFile)) {
    return pidFromFile;
  }
  if (pidFromFile) {
    fs.rmSync(bridgePidFile, { force: true });
  }
  const orphans = findRunningCyberbossPids();
  if (orphans.length > 0) {
    console.error(`[shared] detected ${orphans.length} orphan cyberboss process(es) (PIDs: ${orphans.join(", ")}); killing them`);
    for (const pid of orphans) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
  }
  return 0;
}

function resolveCurrentAccountId() {
  if (!fs.existsSync(accountsDir)) {
    return "";
  }
  const entries = fs.readdirSync(accountsDir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".context-tokens.json"))
    .map((name) => {
      const fullPath = path.join(accountsDir, name);
      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        return {
          accountId: normalizeText(parsed?.accountId),
          savedAt: parseTimestamp(parsed?.savedAt),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((entry) => entry.accountId);
  entries.sort((left, right) => right.savedAt - left.savedAt);
  return entries[0]?.accountId || "";
}

function resolveBoundThread(workspaceRoot) {
  if (!fs.existsSync(sessionFile)) {
    throw new Error(`session file not found: ${sessionFile}`);
  }
  const runtimeId = normalizeText(process.env.CYBERBOSS_RUNTIME || "codex");
  const data = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  const currentAccountId = resolveCurrentAccountId();
  const bindings = Object.values(data.bindings || {})
    .filter((binding) => !currentAccountId || normalizeText(binding?.accountId) === currentAccountId)
    .sort((left, right) => parseTimestamp(right?.updatedAt) - parseTimestamp(left?.updatedAt));

  const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
  const exact = bindings.find((binding) => getThreadId(binding, normalizedWorkspaceRoot, runtimeId));
  if (exact) {
    return {
      threadId: getThreadId(exact, normalizedWorkspaceRoot, runtimeId),
      workspaceRoot: normalizedWorkspaceRoot,
    };
  }

  const active = bindings.find((binding) => {
    const activeWorkspaceRoot = normalizeText(binding?.activeWorkspaceRoot);
    return activeWorkspaceRoot && getThreadId(binding, activeWorkspaceRoot, runtimeId);
  });
  if (active) {
    const activeWorkspaceRoot = normalizeText(active.activeWorkspaceRoot);
    return {
      threadId: getThreadId(active, activeWorkspaceRoot, runtimeId),
      workspaceRoot: activeWorkspaceRoot,
    };
  }

  throw new Error(`no bound WeChat thread found for workspace: ${workspaceRoot}`);
}

function getThreadId(binding, workspaceRoot, runtimeId = "") {
  if (!workspaceRoot) {
    return "";
  }
  const map = getThreadMapForRuntime(binding, runtimeId);
  return normalizeText(map[workspaceRoot]);
}

function getThreadMapForRuntime(binding, runtimeId) {
  const normalizedRuntimeId = normalizeText(runtimeId);
  const runtimeMap = binding && typeof binding.threadIdByWorkspaceRootByRuntime === "object"
    ? binding.threadIdByWorkspaceRootByRuntime
    : {};
  const scoped = runtimeMap[normalizedRuntimeId];
  return scoped && typeof scoped === "object" ? scoped : {};
}

function parseTimestamp(value) {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  rootDir,
  port,
  listenUrl,
  stateDir,
  logDir,
  appServerPidFile,
  bridgePidFile,
  appServerLogFile,
  ensureLogDir,
  isPidAlive,
  readPidFile,
  writePidFile,
  removePidFileIfMatches,
  ensureSharedAppServer,
  ensureBridgeNotRunning,
  resolveBoundThread,
};
