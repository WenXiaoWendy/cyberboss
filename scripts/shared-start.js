const { spawn } = require("child_process");
const path = require("path");
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

function buildSharedStartArgs({ safeBeta: enabled = false, preflightOnly = false } = {}) {
  return [
    "./bin/cyberboss.js",
    "start",
    ...(enabled ? [] : ["--checkin"]),
    ...(preflightOnly ? ["--state-dir-preflight-only"] : []),
  ];
}

async function main() {
  const preflightOnly = process.argv.includes("--state-dir-preflight-only");
  assertSafeBetaStartAllowed({
    safeBeta,
    mode: "shared:start",
    allowedUserIds: String(process.env.CYBERBOSS_ALLOWED_USER_IDS || "").split(","),
  });
  assertSafeSharedStartLifecycle({
    safeBeta,
    preflightOnly,
  });
  if (preflightOnly) {
    await runStateDirPreflightChild();
    return;
  }
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

function runStateDirPreflightChild() {
  return new Promise((resolve, reject) => {
    const childEnv = safeBeta ? buildSafeCodexEnv(process.env) : { ...process.env };
    const child = spawn(process.execPath, [
      path.join(rootDir, "bin", "cyberboss.js"),
      "start",
      "--state-dir-preflight-only",
    ], {
      cwd: process.cwd(),
      env: childEnv,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error("Shared start state directory preflight was interrupted."));
        return;
      }
      if (code !== 0) {
        reject(new Error("Shared start state directory preflight failed."));
        return;
      }
      resolve();
    });
  });
}

function assertSafeSharedStartLifecycle({
  safeBeta: enabled = false,
  preflightOnly = false,
} = {}) {
  if (enabled && !preflightOnly) {
    throw new Error("Safe Beta requires the owned npm run start lifecycle; shared:start is disabled.");
  }
}

module.exports = {
  assertSafeSharedStartLifecycle,
  buildSharedStartArgs,
  main,
};
