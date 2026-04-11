const path = require("path");
const { spawn } = require("child_process");
const os = require("os");

const IS_WINDOWS = os.platform() === "win32";

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
        TIMELINE_FOR_AGENT_CHROME_PATH: resolveTimelineChromePath(),
      }, {
        subcommand: normalizedSubcommand,
      });
    },
  };
}

function resolveTimelineBinPath() {
  const packageJsonPath = require.resolve("timeline-for-agent/package.json");
  return path.join(path.dirname(packageJsonPath), "bin", "timeline-for-agent.js");
}

function runTimelineCommand(binPath, args, extraEnv = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const spawnSpec = buildTimelineSpawnSpec(binPath, args);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv,
      },
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      process.stderr.write(text);
    });

    wireTimelineStdin(child, args);

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`timeline 进程被信号中断: ${signal}`));
        return;
      }
      if (code !== 0) {
        const detail = extractTimelineCommandFailure(stdout, stderr);
        reject(new Error(detail || `timeline 命令执行失败，退出码 ${code}`));
        return;
      }
      if (options.subcommand === "write") {
        const failure = detectTimelineWriteFailure(stdout, stderr);
        if (failure) {
          reject(new Error(failure));
          return;
        }
      }
      resolve();
    });
  });
}

function buildTimelineSpawnSpec(binPath, args = []) {
  if (IS_WINDOWS) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", buildWindowsNodeCommand(process.execPath, binPath, args)],
    };
  }

  return {
    command: process.execPath,
    args: [binPath, ...args],
  };
}

function buildWindowsNodeCommand(nodePath, binPath, args = []) {
  const commandParts = [nodePath, binPath, ...args].map(quoteWindowsCmdArg);
  return commandParts.join(" ");
}

function quoteWindowsCmdArg(value) {
  const text = String(value ?? "");
  if (!text.length) {
    return "\"\"";
  }
  if (!/[\s"]/u.test(text)) {
    return text;
  }
  const escaped = text.replace(/(\\*)"/g, "$1$1\\\"");
  return `"${escaped.replace(/(\\+)$/g, "$1$1")}"`;
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

function resolveTimelineChromePath() {
  const configured = normalizeText(process.env.TIMELINE_FOR_AGENT_CHROME_PATH)
    || normalizeText(process.env.CYBERBOSS_SCREENSHOT_CHROME_PATH);
  if (configured) {
    return configured;
  }
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  return "";
}

function detectTimelineWriteFailure(stdout, stderr) {
  const output = `${stdout}\n${stderr}`;
  const statusMatch = output.match(/^\s*status:\s*(.+)\s*$/m);
  const eventsMatch = output.match(/^\s*events:\s*(\d+)\s*$/m);
  const status = normalizeText(statusMatch?.[1]);
  const events = Number.parseInt(eventsMatch?.[1] || "", 10);
  if (status === "missing" && Number.isFinite(events) && events <= 0) {
    return "timeline write 没有写入任何事件；当前结果是 events: 0 且 status: missing。请检查是否真的传入了有效 JSON events。";
  }
  return "";
}

function extractTimelineCommandFailure(stdout, stderr) {
  const output = `${stderr}\n${stdout}`;
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const targeted = lines.find((line) => line.includes("timeline 事件无效"))
    || lines.find((line) => line.includes("timeline 事件不能跨天"))
    || lines.find((line) => line.includes("timeline-write"))
    || lines.at(-1);

  return targeted || "";
}

function wireTimelineStdin(child, args = []) {
  if (!child?.stdin) {
    return;
  }

  const shouldForward = Array.isArray(args)
    && args.some((value) => String(value || "").trim() === "--stdin");

  if (!shouldForward) {
    child.stdin.end();
    return;
  }

  if (process.stdin.isTTY) {
    child.stdin.end();
    return;
  }

  process.stdin.pipe(child.stdin);
}

module.exports = { createTimelineIntegration };
