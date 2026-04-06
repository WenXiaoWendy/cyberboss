const path = require("path");
const { spawn } = require("child_process");

function createTimelineIntegration(config) {
  const binPath = resolveTimelineBinPath();

  return {
    describe() {
      return {
        id: "timeline-for-agent",
        kind: "integration",
        command: `${process.execPath} ${binPath}`,
        stateDir: config.stateDir,
      };
    },
    async runSubcommand(subcommand, args = []) {
      const normalizedSubcommand = normalizeText(subcommand);
      if (!normalizedSubcommand) {
        throw new Error("timeline 子命令不能为空");
      }
      return runTimelineCommand(binPath, [normalizedSubcommand, ...normalizeArgs(args)], {
        TIMELINE_FOR_AGENT_STATE_DIR: config.stateDir,
      });
    },
  };
}

function resolveTimelineBinPath() {
  const packageJsonPath = require.resolve("timeline-for-agent/package.json");
  return path.join(path.dirname(packageJsonPath), "bin", "timeline-for-agent.js");
}

function runTimelineCommand(binPath, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      stdio: "inherit",
      env: {
        ...process.env,
        ...extraEnv,
      },
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`timeline 进程被信号中断: ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`timeline 命令执行失败，退出码 ${code}`));
        return;
      }
      resolve();
    });
  });
}

function normalizeArgs(args) {
  return Array.isArray(args)
    ? args
      .map((value) => String(value ?? ""))
      .filter((value) => value.length > 0)
    : [];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { createTimelineIntegration };
