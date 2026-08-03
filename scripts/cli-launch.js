const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const { resolveCyberbossEnv } = require("../src/core/env-loader");
const { launchOwnedChild } = require("../src/core/owned-process-lifecycle");
const { isSafeBetaEnabled } = require("../src/core/safe-beta");
const { assertSafeBetaStateDir } = require("../src/core/state-dir-preflight");

const ROOT = path.resolve(__dirname, "..");

function buildCliLaunchSpec({
  command,
  args = [],
  cwd = process.cwd(),
  baseEnv = process.env,
} = {}) {
  const resolved = resolveCyberbossEnv({ cwd, baseEnv });
  const safeBeta = isSafeBetaEnabled(resolved.env.CYBERBOSS_SAFE_BETA);
  assertSafeBetaStateDir({
    safeBeta,
    mode: command,
    stateDir: resolved.stateDir,
    defaultStateDir: resolved.defaultStateDir,
    stateEnvLoaded: resolved.stateEnvLoaded,
  });

  const target = command === "shared:start"
    ? path.join(ROOT, "scripts", "shared-start.js")
    : path.join(ROOT, "bin", "cyberboss.js");
  const targetArgs = command === "shared:start"
    ? [...args]
    : [command, ...args];

  return {
    command: process.execPath,
    args: [target, ...targetArgs],
    cwd,
    env: {
      ...resolved.env,
      CYBERBOSS_STATE_DIR: resolved.stateDir,
    },
    safeBeta,
  };
}

async function main() {
  const [command = "", ...args] = process.argv.slice(2);
  if (!command) {
    throw new Error("Cyberboss CLI launch command is required.");
  }
  const spec = buildCliLaunchSpec({ command, args });
  if (
    command === "start" &&
    spec.safeBeta &&
    !args.includes("--state-dir-preflight-only")
  ) {
    await runOwnedSafeBridge(spec);
    return;
  }
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    shell: false,
    stdio: "inherit",
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      process.exitCode = Number.isInteger(code) ? code : 1;
      resolve();
    });
  });
}

async function runOwnedSafeBridge(spec) {
  const controller = launchOwnedChild({
    spawnImpl: spawn,
    executable: spec.command,
    args: spec.args,
    cwd: spec.cwd,
    env: spec.env,
    runToken: crypto.randomUUID(),
    parentPid: process.pid,
    protectedPids: [process.pid, process.ppid],
  });
  let stopRequested = false;
  const requestCooperativeStop = async () => {
    if (stopRequested) {
      return;
    }
    stopRequested = true;
    const result = await controller.requestStop();
    if (!result.stopped) {
      console.error(`[cyberboss] safe bridge stop refused: ${result.reason}; residual pid=${result.residualPid}`);
      process.exitCode = 1;
    }
  };
  const onSignal = () => {
    void requestCooperativeStop();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    try {
      await controller.ready;
    } catch (error) {
      const stopResult = await controller.requestStop();
      if (!stopResult.stopped) {
        throw new Error(`${error.message} Cleanup refused: ${stopResult.reason}; residual pid=${stopResult.residualPid}.`);
      }
      throw error;
    }
    const outcome = await controller.exited;
    process.exitCode = Number.isInteger(outcome.code) ? outcome.code : 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    controller.dispose();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[cyberboss] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCliLaunchSpec,
  runOwnedSafeBridge,
};
