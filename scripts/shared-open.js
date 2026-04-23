const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const {
  listenUrl,
  ensureSharedAppServer,
  resolveBoundThread,
} = require("./shared-common");

async function main() {
  const workspaceRoot = process.env.CYBERBOSS_WORKSPACE_ROOT || process.cwd();
  const runtime = process.env.CYBERBOSS_RUNTIME || "codex";

  if (runtime === "codex") {
    await ensureSharedAppServer();
    const { threadId, workspaceRoot: resolvedWorkspaceRoot } = resolveBoundThread(workspaceRoot);
    const child = spawn(process.env.CYBERBOSS_CODEX_COMMAND || "codex", [
      "resume",
      threadId,
      "--remote",
      listenUrl,
      "-C",
      resolvedWorkspaceRoot,
      ...process.argv.slice(2),
    ], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
    });
    return;
  }

  // For Claude: connect to the bridge's IPC socket so we can observe and
  // interact with the same ClaudeCode process that handles WeChat messages.
  const stateDir = process.env.CYBERBOSS_STATE_DIR || path.join(os.homedir(), ".cyberboss");
  const socketPath = path.join(stateDir, "claudecode-runtime.sock");
  const connectPath = process.platform === "win32"
    ? `\\\\.\\pipe\\${path.basename(socketPath).replace(/\.sock$/i, "")}`
    : socketPath;

  if (process.platform !== "win32" && !fs.existsSync(socketPath)) {
    console.error(`Claude IPC socket not found: ${socketPath}`);
    console.error("Make sure the bridge is running with CYBERBOSS_RUNTIME=claudecode.");
    process.exit(1);
  }

  const socket = net.createConnection(connectPath);
  socket.setEncoding("utf8");

  let connected = false;
  await new Promise((resolve, reject) => {
    socket.once("connect", () => {
      connected = true;
      resolve();
    });
    socket.once("error", (err) => reject(err));
    setTimeout(() => reject(new Error("connect timeout")), 3000);
  });

  console.log(`Connected to ClaudeCode bridge IPC (${socketPath})`);
  console.log(`Observing workspace: ${workspaceRoot}`);
  console.log("Type your message and press Enter to send. Ctrl+C to exit.\n");

  // Authenticate with the IPC server
  const tokenFile = `${socketPath}.token`;
  let authToken = "";
  try {
    authToken = fs.readFileSync(tokenFile, "utf8").trim();
  } catch {
    console.error(`Failed to read IPC auth token: ${tokenFile}`);
    process.exit(1);
  }
  socket.write(JSON.stringify({ type: "auth", token: authToken }) + "\n");

  // Handle incoming events from the bridge
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        handleIpcMessage(msg);
      } catch {
        // ignore malformed
      }
    }
  });

  socket.on("close", () => {
    if (connected) {
      console.log("\n[IPC disconnected]");
      process.exit(0);
    }
  });

  socket.on("error", (err) => {
    console.error(`[IPC error] ${err.message}`);
    process.exit(1);
  });

  // Read user input from terminal
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.prompt();

  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }
    const payload = JSON.stringify({
      type: "sendUserMessage",
      workspaceRoot,
      text,
    }) + "\n";
    socket.write(payload);
  });

  rl.on("close", () => {
    console.log("\n[Exiting]");
    socket.end();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    rl.close();
  });
}

const c = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
};

let turnCount = 0;

function handleIpcMessage(msg) {
  if (msg.type === "processEvent") {
    const event = msg.event;
    switch (event?.type) {
      case "turn.started":
        turnCount += 1;
        break;
      case "reply.completed":
        console.log(`\n${c.cyan}[ClaudeCode → WeChat]${c.reset}\n${event.text}\n`);
        break;
      case "turn.completed":
        console.log(`${c.gray}─────────────────────────${c.reset}`);
        break;
        console.log(`\n${c.cyan}[ClaudeCode → WeChat]${c.reset}\n${event.text}\n`);
        break;
      case "tool.use": {
        const inputStr = event.input
          ? JSON.stringify(event.input, null, 2)
          : "";
        console.log(`\n${c.yellow}● ${formatReadableToolName(event.toolName) || "Tool"}${c.reset}`);
        if (inputStr) {
          console.log(inputStr.split("\n").map((l) => `  ${l}`).join("\n"));
        }
        console.log("");
        break;
      }
      case "tool.result": {
        const status = event.isError
          ? `${c.red}ERROR${c.reset}`
          : `${c.green}OK${c.reset}`;
        const bulletColor = event.isError ? c.red : c.green;
        console.log(`\n  ${bulletColor}● ${status}${c.reset}`);
        if (event.toolResult) {
          console.log(event.toolResult.split("\n").map((l) => `    ${l}`).join("\n"));
        }
        console.log("");
        break;
      }
      case "thinking":
        console.log(`\n${c.gray}[Thinking]${c.reset}\n${event.text}\n`);
        break;
      case "approval.requested": {
        if (isProjectNativeToolApproval(event.toolName)) {
          break;
        }
        const inputStr = event.input
          ? JSON.stringify(event.input, null, 2)
          : "";
        console.log(`\n${c.magenta}[Approval] ${formatReadableToolName(event.toolName) || ""}${c.reset}`);
        if (inputStr) console.log(inputStr);
        console.log(`${c.gray}─────────────────────────${c.reset}`);
        console.log(`Reply: ${c.green}/yes${c.reset}  ${c.yellow}/always${c.reset}  ${c.red}/no${c.reset}\n`);
        break;
      }
      case "process.error":
        console.log(`\n${c.red}[process error]${c.reset} ${event.error}\n`);
        break;
      case "process.close":
        console.log(`\n${c.red}[process closed]${c.reset} code=${event.code}\n`);
        break;
    }
  } else if (msg.type === "stderr") {
    console.log(`[stderr] ${msg.text}`);
  } else if (msg.type === "inboundMessage") {
    console.log(`\n${c.cyan}[WeChat → ClaudeCode]${c.reset}\n${msg.text || ""}\n`);
  }
}

function formatReadableToolName(toolName) {
  const normalized = typeof toolName === "string" ? toolName.trim() : "";
  if (!normalized.startsWith("mcp__")) {
    return normalized;
  }
  const parts = normalized.split("__").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "mcp") {
    return normalized;
  }
  return parts.slice(2).join("__") || normalized;
}

function isProjectNativeToolApproval(toolName) {
  const normalized = typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
  return normalized.startsWith("mcp__cyberboss_tools__");
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
