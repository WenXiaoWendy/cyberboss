const { spawn } = require("child_process");
const {
  rootDir,
  listenUrl,
  bridgePidFile,
  writePidFile,
  removePidFileIfMatches,
  ensureSharedAppServer,
  ensureBridgeNotRunning,
  safeBeta,
} = require("./shared-common");
const { assertSafeBetaStartAllowed, buildSafeCodexEnv } = require("../src/core/safe-beta");

function buildSharedStartArgs({ safeBeta: enabled = false } = {}) {
  return ["./bin/cyberboss.js", "start", ...(enabled ? [] : ["--checkin"])];
}

async function main() {
  assertSafeBetaStartAllowed({
    safeBeta,
    mode: "shared:start",
    allowedUserIds: String(process.env.CYBERBOSS_ALLOWED_USER_IDS || "").split(","),
  });
  const runtime = process.env.CYBERBOSS_RUNTIME || "codex";
  console.log(`starting shared bridge runtime=${runtime}`);
  const appServer = await ensureSharedAppServer();
  const appServerPidLabel = appServer.pid ? ` pid=${appServer.pid}` : "";
  if (appServer.status === "skipped") {
    console.log(`shared app-server skipped (runtime=${runtime})`);
  } else {
    console.log(`shared app-server ${appServer.status}${appServerPidLabel} listen=${listenUrl}`);
  }

  const existingBridgePid = ensureBridgeNotRunning();
  if (existingBridgePid) {
    console.log(`shared cyberboss already running pid=${existingBridgePid}`);
    return;
  }

  const childEnv = safeBeta ? buildSafeCodexEnv(process.env) : { ...process.env };
  const isCodex = runtime === "codex";
  if (isCodex) {
    childEnv.CYBERBOSS_CODEX_ENDPOINT = listenUrl;
  }

  const child = spawn(process.execPath, buildSharedStartArgs({ safeBeta }), {
    cwd: rootDir,
    env: childEnv,
    stdio: "inherit",
  });

  writePidFile(bridgePidFile, child.pid);
  const cleanup = () => removePidFileIfMatches(bridgePidFile, child.pid);
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    child.kill("SIGTERM");
  });

  child.on("exit", (code, signal) => {
    cleanup();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

module.exports = { buildSharedStartArgs, main };
