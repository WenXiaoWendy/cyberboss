const fs = require("fs");
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
        throw new Error("timeline subcommand cannot be empty");
      }
      const prepared = prepareTimelineInvocation(normalizedSubcommand, args);
      return runTimelineCommand(binPath, [normalizedSubcommand, ...prepared.args], {
        TIMELINE_FOR_AGENT_STATE_DIR: config.stateDir,
        TIMELINE_FOR_AGENT_CHROME_PATH: resolveTimelineChromePath(),
        ...prepared.extraEnv,
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
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv,
      },
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finishResolve = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      const startup = detectTimelineServerStartup(options.subcommand, stdout);
      if (startup) {
        finishResolve({
          subcommand: options.subcommand || "",
          args,
          stdout,
          stderr,
          ...startup,
        });
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
    });

    child.once("error", (error) => {
      finishReject(error);
    });
    child.once("exit", (code, signal) => {
      if (signal) {
        finishReject(new Error(`timeline process was interrupted by signal: ${signal}`));
        return;
      }
      if (code !== 0) {
        finishReject(new Error(buildTimelineFailureMessage({
          subcommand: options.subcommand,
          code,
          stdout,
          stderr,
        })));
        return;
      }
      if (options.subcommand === "write") {
        const failure = detectTimelineWriteFailure(stdout, stderr);
        if (failure) {
          finishReject(new Error(failure));
          return;
        }
      }
      finishResolve({
        subcommand: options.subcommand || "",
        args,
        stdout,
        stderr,
        ...detectTimelineSuccess(options.subcommand, stdout),
      });
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

function prepareTimelineInvocation(subcommand, args = []) {
  const normalizedSubcommand = normalizeText(subcommand);
  const normalizedArgs = normalizeArgs(args);
  const preparedArgs = [];
  const extraEnv = {};
  let sawJsonArgument = false;
  let sawEventsSource = false;

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const token = normalizedArgs[index];
    const next = normalizedArgs[index + 1];

    if (token === "--locale") {
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for argument: --locale");
      }
      extraEnv.TIMELINE_FOR_AGENT_LOCALE = next;
      index += 1;
      continue;
    }

    if (normalizedSubcommand === "write" && token === "--events-json") {
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for argument: --events-json");
      }
      if (sawJsonArgument || sawEventsSource) {
        throw new Error("Use only one of --json, --events-json, or --events-file");
      }
      preparedArgs.push("--json", next);
      sawEventsSource = true;
      index += 1;
      continue;
    }

    if (normalizedSubcommand === "write" && token === "--events-file") {
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for argument: --events-file");
      }
      if (sawJsonArgument || sawEventsSource) {
        throw new Error("Use only one of --json, --events-json, or --events-file");
      }
      preparedArgs.push("--json", fs.readFileSync(path.resolve(next), "utf8"));
      sawEventsSource = true;
      index += 1;
      continue;
    }

    if (normalizedSubcommand === "write" && token === "--json") {
      if (sawEventsSource) {
        throw new Error("Use only one of --json, --events-json, or --events-file");
      }
      sawJsonArgument = true;
    }

    preparedArgs.push(token);
  }

  return { args: preparedArgs, extraEnv };
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
    return "timeline write did not persist any events. The result was events: 0 and status: missing. Check whether you passed valid JSON events.";
  }
  return "";
}

function detectTimelineServerStartup(subcommand, stdout) {
  const normalizedSubcommand = normalizeText(subcommand);
  if (normalizedSubcommand === "serve") {
    const url = matchTimelineUrl(stdout, /timeline dashboard:\s*(https?:\/\/\S+)/i);
    if (url) {
      return { url };
    }
  }
  if (normalizedSubcommand === "dev") {
    const url = matchTimelineUrl(stdout, /timeline dev:\s*(https?:\/\/\S+)/i);
    if (url) {
      return { url };
    }
  }
  return null;
}

function detectTimelineSuccess(subcommand, stdout) {
  const startup = detectTimelineServerStartup(subcommand, stdout);
  if (startup) {
    return startup;
  }
  if (normalizeText(subcommand) === "screenshot") {
    const outputFile = matchTimelineText(stdout, /timeline screenshot saved:\s*(.+)/i);
    if (outputFile) {
      return { outputFile };
    }
  }
  return {};
}

function buildTimelineFailureMessage({ subcommand = "", code = 0, stdout = "", stderr = "" } = {}) {
  const output = `${stdout}\n${stderr}`.trim();
  const normalizedSubcommand = normalizeText(subcommand) || "command";
  const errorSummary = extractTimelineErrorSummary(output);
  const portInUse = /(EADDRINUSE|address already in use|listen EADDRINUSE)/i.test(output);
  if (portInUse) {
    const port = matchTimelineText(errorSummary || output, /(?:127\.0\.0\.1:|port\s+)(\d{2,5})/i);
    return `timeline ${normalizedSubcommand} failed because the port is already in use${port ? ` (${port})` : ""}. ${errorSummary || summarizeTimelineOutput(output)}`;
  }
  const siteMissing = /timeline site not built/i.test(output);
  if (siteMissing) {
    return `timeline ${normalizedSubcommand} failed because the site is not built. ${errorSummary || summarizeTimelineOutput(output)}`;
  }
  return `timeline ${normalizedSubcommand} failed with exit code ${code}. ${errorSummary || summarizeTimelineOutput(output)}`;
}

function extractTimelineErrorSummary(output) {
  const lines = String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return "";
  }
  const explicitError = lines.find((line) => /^Error:/i.test(line));
  if (explicitError) {
    return explicitError;
  }
  const invalidEvent = lines.find((line) => /Invalid timeline event at index/i.test(line));
  if (invalidEvent) {
    return invalidEvent;
  }
  const lockError = lines.find((line) => /timeline-write is currently locked by another process/i.test(line));
  if (lockError) {
    return lockError;
  }
  return "";
}

function summarizeTimelineOutput(output) {
  const normalized = String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!normalized.length) {
    return "No additional output was captured.";
  }
  return `Output: ${normalized.slice(-4).join(" | ")}`;
}

function matchTimelineUrl(text, pattern) {
  return matchTimelineText(text, pattern);
}

function matchTimelineText(text, pattern) {
  const match = String(text || "").match(pattern);
  return normalizeText(match?.[1]);
}

module.exports = {
  createTimelineIntegration,
  buildTimelineFailureMessage,
  detectTimelineServerStartup,
  prepareTimelineInvocation,
};
