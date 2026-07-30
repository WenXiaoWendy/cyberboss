const path = require("path");
const { spawn } = require("child_process");

const { resolveCyberbossEnv } = require("../src/core/env-loader");
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
  };
}

function main() {
  const [command = "", ...args] = process.argv.slice(2);
  if (!command) {
    throw new Error("Cyberboss CLI launch command is required.");
  }
  const spec = buildCliLaunchSpec({ command, args });
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error(`[cyberboss] CLI child failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = Number.isInteger(code) ? code : 1;
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[cyberboss] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildCliLaunchSpec,
};
