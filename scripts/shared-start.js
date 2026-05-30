const { spawn } = require("child_process");
const {
  rootDir,
  listenUrl,
  bridgePidFile,
  writePidFile,
  removePidFileIfMatches,
  ensureSharedAppServer,
  ensureBridgeNotRunning,
} = require("./shared-common");

const MAX_BACKOFF_MS = 60_000;
const STABLE_UPTIME_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
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

  const childEnv = { ...process.env };
  const isCodex = runtime === "codex";
  if (isCodex) {
    childEnv.CYBERBOSS_CODEX_ENDPOINT = listenUrl;
  }

  let restartCount = 0;
  let stableSince = Date.now();
  let shuttingDown = false;
  let currentChild = null;

  const shutdown = () => {
    shuttingDown = true;
    if (currentChild && !currentChild.killed) {
      currentChild.kill("SIGTERM");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!shuttingDown) {
    currentChild = spawn(process.execPath, ["./bin/cyberboss.js", "start", "--checkin"], {
      cwd: rootDir,
      env: childEnv,
      stdio: "inherit",
    });

    writePidFile(bridgePidFile, currentChild.pid);

    const exitResult = await new Promise((resolve) => {
      currentChild.on("error", (err) => {
        resolve({ code: 1, signal: null, error: err });
      });
      currentChild.on("exit", (code, signal) => {
        resolve({ code, signal, error: null });
      });
    });

    removePidFileIfMatches(bridgePidFile, currentChild.pid);

    if (exitResult.error) {
      console.error(`[shared] failed to spawn bridge: ${exitResult.error.message}`);
    }

    if (shuttingDown) {
      process.exit(exitResult.signal ? 0 : (exitResult.code ?? 0));
      return;
    }

    if (exitResult.signal) {
      console.error(`[shared] bridge killed by signal ${exitResult.signal}; shutting down`);
      process.exit(1);
      return;
    }

    const uptime = Date.now() - stableSince;
    if (uptime >= STABLE_UPTIME_MS) {
      restartCount = 0;
    }

    const delay = Math.min(1000 * Math.pow(2, restartCount), MAX_BACKOFF_MS);
    restartCount += 1;
    console.error(
      `[shared] bridge exited code=${exitResult.code ?? "unknown"}; restarting in ${Math.round(delay / 1000)}s (attempt ${restartCount})`
    );
    await sleep(delay);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
