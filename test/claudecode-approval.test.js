const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const { CyberbossApp } = require("../src/core/app");
const { mapClaudeCodeMessageToRuntimeEvent } = require("../src/adapters/runtime/claudecode/events");
const { createClaudeCodeRuntimeAdapter } = require("../src/adapters/runtime/claudecode");
const { ClaudeCodeProcessClient } = require("../src/adapters/runtime/claudecode/process-client");
const { SessionStore } = require("../src/adapters/runtime/codex/session-store");

test("claudecode approval events extract command tokens from exec_command input", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "approval.requested",
    sessionId: "thread-1",
    requestId: "req-1",
    toolName: "exec_command",
    input: {
      cmd: "cyberboss reminder write --delay 30m --text 'Reminder text'",
    },
  });

  assert.deepEqual(event.payload.commandTokens, ["cyberboss", "reminder", "write"]);
});

test("claudecode approval events prefer prefix_rule when present", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "approval.requested",
    sessionId: "thread-1",
    requestId: "req-2",
    toolName: "exec_command",
    input: {
      cmd: "npm run timeline:build -- --locale en",
      prefix_rule: ["npm", "run", "timeline:build"],
    },
  });

  assert.deepEqual(event.payload.commandTokens, ["npm", "run", "timeline:build"]);
});

test("claudecode approval events canonicalize diary commands for stable always matching", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "approval.requested",
    sessionId: "thread-1",
    requestId: "req-diary",
    toolName: "exec_command",
    input: {
      cmd: "/Users/tingyiwen/Dev/cyberboss/bin/cyberboss diary write --date 2026-04-17 --title '4.17' --text 'hello'",
    },
  });

  assert.deepEqual(event.payload.commandTokens, ["cyberboss", "diary", "write"]);
});

test("claudecode approval events canonicalize view_image tool approvals", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "approval.requested",
    sessionId: "thread-1",
    requestId: "req-img",
    toolName: "view_image",
    input: {
      path: "/tmp/example.png",
    },
  });

  assert.deepEqual(event.payload.commandTokens, ["view_image"]);
});

test("claudecode approval events canonicalize MCP tool approvals for stable always matching", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "approval.requested",
    sessionId: "thread-1",
    requestId: "req-mcp-timeline",
    toolName: "mcp__cyberboss_tools__cyberboss_timeline_write",
    input: {
      date: "2026-04-21",
      events: [],
    },
  });

  assert.deepEqual(event.payload.commandTokens, ["mcp_tool", "cyberboss_tools", "cyberboss_timeline_write"]);
  assert.match(event.payload.command, /^cyberboss_timeline_write\b/);
});

test("claudecode approval events canonicalize Read image approvals for stable matching", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "approval.requested",
    sessionId: "thread-1",
    requestId: "req-read-image",
    toolName: "Read",
    input: {
      file_path: "/Users/tingyiwen/.cyberboss/inbox/2026-04-17/attachment-5.jpg",
    },
  });

  assert.deepEqual(event.payload.commandTokens, ["read_image"]);
  assert.equal(event.payload.filePath, "/Users/tingyiwen/.cyberboss/inbox/2026-04-17/attachment-5.jpg");
});

test("claudecode approval events keep non-image Read approvals as file reads", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "approval.requested",
    sessionId: "thread-1",
    requestId: "req-read-text",
    toolName: "Read",
    input: {
      file_path: "/Users/tingyiwen/.cyberboss/inbox/2026-04-17/note.txt",
    },
  });

  assert.deepEqual(event.payload.commandTokens, []);
  assert.equal(event.payload.filePath, "/Users/tingyiwen/.cyberboss/inbox/2026-04-17/note.txt");
});

test("claudecode approval events capture Write file paths for state-dir auto approve", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "approval.requested",
    sessionId: "thread-1",
    requestId: "req-write",
    toolName: "Write",
    input: {
      file_path: "/Users/tingyiwen/.cyberboss/notes/today.md",
      content: "hello",
    },
  });

  assert.equal(event.payload.filePath, "/Users/tingyiwen/.cyberboss/notes/today.md");
  assert.deepEqual(event.payload.filePaths, ["/Users/tingyiwen/.cyberboss/notes/today.md"]);
});

test("claudecode adapter exposes image file read capability only for known image-capable models", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-claude-vision-"));
  const adapter = createClaudeCodeRuntimeAdapter({
    stateDir: tempDir,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });
  const configured = createClaudeCodeRuntimeAdapter({
    stateDir: tempDir,
    sessionsFile: path.join(tempDir, "configured-sessions.json"),
    claudeModel: "sonnet",
  });

  assert.deepEqual(adapter.getTurnCapabilities({ model: "" }), {
    nativeImageInput: false,
    toolImageRead: false,
  });
  assert.deepEqual(adapter.getTurnCapabilities({ model: "claude-sonnet" }), {
    nativeImageInput: false,
    toolImageRead: true,
  });
  assert.deepEqual(adapter.getTurnCapabilities({ model: "deepseek-chat" }), {
    nativeImageInput: false,
    toolImageRead: false,
  });
  assert.deepEqual(configured.getTurnCapabilities({ model: "deepseek-chat" }), {
    nativeImageInput: false,
    toolImageRead: true,
  });
});

test("claudecode adapter hydrates model from Claude project transcript", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-claude-project-model-"));
  const stateDir = path.join(tempDir, "state");
  const claudeConfigDir = path.join(tempDir, "claude");
  const workspaceRoot = path.join(tempDir, "workspace root");
  const sessionId = "77777777-7777-4777-8777-777777777777";
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const projectDir = path.join(claudeConfigDir, "projects", workspaceRoot.replace(/[\\/:\s]+/g, "-"));
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: "assistant", message: { model: "deepseek-v4-flash" } }),
    JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4-6" } }),
  ].join("\n"));
  const sessionsFile = path.join(tempDir, "sessions.json");
  new SessionStore({ filePath: sessionsFile, runtimeId: "claudecode" })
    .setThreadIdForWorkspace("binding-1", workspaceRoot, sessionId);

  const adapter = createClaudeCodeRuntimeAdapter({
    stateDir,
    sessionsFile,
    claudeConfigDir,
  });

  assert.deepEqual(adapter.getSessionStore().getRuntimeParamsForWorkspace("binding-1", workspaceRoot), {
    model: "claude-sonnet-4-6",
    modelProvider: "",
  });
});

test("claudecode adapter remembers model observed in stream messages", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-claude-stream-model-"));
  const workspaceRoot = path.join(tempDir, "workspace");
  const stateDir = path.join(tempDir, "state");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const commandFile = path.join(tempDir, "fake-claude.js");
  const sessionId = "88888888-8888-4888-8888-888888888888";
  fs.writeFileSync(commandFile, [
    "#!/usr/bin/env node",
    "process.stdin.on(\"data\", () => {",
    `  console.log(JSON.stringify({ type: "system", session_id: ${JSON.stringify(sessionId)} }));`,
    "  console.log(JSON.stringify({ type: \"assistant\", message: { model: \"claude-sonnet-4-6\", content: [{ type: \"text\", text: \"done\" }] } }));",
    `  console.log(JSON.stringify({ type: "result", session_id: ${JSON.stringify(sessionId)}, result: "done" }));`,
    "  process.exit(0);",
    "});",
  ].join("\n"));
  fs.chmodSync(commandFile, 0o755);

  const adapter = createClaudeCodeRuntimeAdapter({
    stateDir,
    sessionsFile: path.join(tempDir, "sessions.json"),
    claudeCommand: commandFile,
    claudeDisableVerbose: true,
  });

  try {
    await adapter.sendTurn({
      bindingKey: "binding-1",
      workspaceRoot,
      text: "hello",
    });
    const sessionsText = await waitForFileText(path.join(tempDir, "sessions.json"), /claude-sonnet-4-6/);
    assert.match(sessionsText, /claude-sonnet-4-6/);
    assert.deepEqual(adapter.getSessionStore().getRuntimeParamsForWorkspace("binding-1", workspaceRoot), {
      model: "claude-sonnet-4-6",
      modelProvider: "",
    });
  } finally {
    await adapter.close();
  }
});

test("claudecode assistant events map usage into context snapshots", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent(
    {
      type: "context.updated",
      sessionId: "thread-1",
    },
    {
      message: {
        usage: {
          input_tokens: 7,
          cache_creation_input_tokens: 12150,
          cache_read_input_tokens: 13535,
          output_tokens: 1509,
        },
      },
    },
  );

  assert.equal(event.type, "runtime.context.updated");
  assert.equal(event.payload.runtimeId, "claudecode");
  assert.equal(event.payload.threadId, "thread-1");
  assert.equal(event.payload.currentTokens, 27201);
});

test("claudecode adapter dispatches turns only after a real session id is available", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-claude-"));
  const workspaceRoot = path.join(tempDir, "workspace");
  const stateDir = path.join(tempDir, "state");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const captureFile = path.join(tempDir, "stdin.log");
  const commandFile = path.join(tempDir, "fake-claude.js");
  const sessionId = "11111111-1111-4111-8111-111111111111";
  fs.writeFileSync(commandFile, [
    "#!/usr/bin/env node",
    `const fs = require("node:fs");`,
    "process.stdin.on(\"data\", (chunk) => {",
    `  fs.appendFileSync(${JSON.stringify(captureFile)}, chunk);`,
    `  console.log(JSON.stringify({ type: "system", session_id: ${JSON.stringify(sessionId)} }));`,
    "  process.exit(0);",
    "});",
  ].join("\n"));
  fs.chmodSync(commandFile, 0o755);

  const adapter = createClaudeCodeRuntimeAdapter({
    stateDir,
    sessionsFile: path.join(tempDir, "sessions.json"),
    claudeCommand: commandFile,
    claudePermissionMode: "default",
    claudeDisableVerbose: true,
    claudeExtraArgs: [],
  });

  try {
    const turn = await adapter.sendTurn({
      bindingKey: "binding-1",
      workspaceRoot,
      text: "hello",
      metadata: {
        senderId: "user-1",
      },
      model: "claude-sonnet",
    });

    assert.equal(turn.threadId, sessionId);
    assert.match(turn.turnId, /^turn-\d+$/);
    assert.equal(adapter.getSessionStore().getThreadIdForWorkspace("binding-1", workspaceRoot), sessionId);
    assert.deepEqual(adapter.getSessionStore().getRuntimeParamsForWorkspace("binding-1", workspaceRoot), {
      model: "claude-sonnet",
      modelProvider: "",
    });
    assert.doesNotMatch(turn.threadId, /^pending-/);
    assert.match(await waitForFileText(captureFile, /hello/), /hello/);
  } finally {
    await adapter.close();
  }
});

test("claudecode process client treats assistant text as non-deliverable until the result event", () => {
  const client = new ClaudeCodeProcessClient({
    command: "claude",
    cwd: "/workspace",
    env: {},
  });
  client.pendingTurnId = "turn-tool";
  client.sessionId = "thread-tool";
  client.activeThreadId = "thread-tool";
  const messages = [];
  client.onMessage((event, raw) => {
    messages.push({ event, raw });
  });

  client.handleAssistant({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "我先查一下。" },
        { type: "tool_use", name: "mcp__cyberboss_tools__cyberboss_timeline_read", input: { date: "2026-05-19" } },
      ],
    },
  });
  client.handleResult({
    type: "result",
    session_id: "thread-tool",
    result: "查完了，这是工具后的最终结果。",
  });

  assert.deepEqual(messages.map((entry) => entry.event.type), [
    "assistant.text",
    "tool.use",
    "turn.completed",
  ]);
  assert.equal(mapClaudeCodeMessageToRuntimeEvent(messages[0].event, messages[0].raw), null);
  const completed = mapClaudeCodeMessageToRuntimeEvent(messages[2].event, messages[2].raw);
  assert.equal(completed.type, "runtime.turn.completed");
  assert.equal(completed.payload.threadId, "thread-tool");
  assert.equal(completed.payload.turnId, "turn-tool");
  assert.equal(completed.payload.text, "查完了，这是工具后的最终结果。");
});

test("claudecode runtime params are isolated from codex model selections", () => {
  const sessionsFile = path.join(
    os.tmpdir(),
    `cyberboss-runtime-params-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  const codexStore = new SessionStore({ filePath: sessionsFile, runtimeId: "codex" });
  const claudecodeStore = new SessionStore({ filePath: sessionsFile, runtimeId: "claudecode" });

  codexStore.setRuntimeParamsForWorkspace("binding-1", "/workspace", {
    model: "gpt-5.5",
    modelProvider: "openai",
  });

  assert.deepEqual(claudecodeStore.getRuntimeParamsForWorkspace("binding-1", "/workspace"), {
    model: "",
    modelProvider: "",
  });

  claudecodeStore.setRuntimeParamsForWorkspace("binding-1", "/workspace", {
    model: "deepseek-v4-pro",
  });

  assert.deepEqual(codexStore.getRuntimeParamsForWorkspace("binding-1", "/workspace"), {
    model: "gpt-5.5",
    modelProvider: "openai",
  });
  assert.deepEqual(claudecodeStore.getRuntimeParamsForWorkspace("binding-1", "/workspace"), {
    model: "deepseek-v4-pro",
    modelProvider: "",
  });
});

test("claudecode adapter does not pass a codex-selected model to Claude Code", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-claude-model-"));
  const workspaceRoot = path.join(tempDir, "workspace");
  const stateDir = path.join(tempDir, "state");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const sessionsFile = path.join(tempDir, "sessions.json");
  const argsFile = path.join(tempDir, "args.json");
  const commandFile = path.join(tempDir, "fake-claude.js");
  const sessionId = "22222222-2222-4222-8222-222222222222";
  new SessionStore({ filePath: sessionsFile, runtimeId: "codex" })
    .setRuntimeParamsForWorkspace("binding-1", workspaceRoot, {
      model: "gpt-5.5",
      modelProvider: "openai",
    });
  fs.writeFileSync(commandFile, [
    "#!/usr/bin/env node",
    `const fs = require("node:fs");`,
    `fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));`,
    "process.stdin.on(\"data\", () => {",
    `  console.log(JSON.stringify({ type: "system", session_id: ${JSON.stringify(sessionId)} }));`,
    "  process.exit(0);",
    "});",
  ].join("\n"));
  fs.chmodSync(commandFile, 0o755);

  const adapter = createClaudeCodeRuntimeAdapter({
    stateDir,
    sessionsFile,
    claudeCommand: commandFile,
    claudePermissionMode: "default",
    claudeDisableVerbose: true,
    claudeExtraArgs: [],
  });

  try {
    await adapter.sendTurn({
      bindingKey: "binding-1",
      workspaceRoot,
      text: "hello",
    });
    const args = JSON.parse(await waitForFileText(argsFile, /]/));
    assert.equal(args.includes("--model"), false);
    assert.equal(args.includes("gpt-5.5"), false);
    assert.deepEqual(adapter.getSessionStore().getRuntimeParamsForWorkspace("binding-1", workspaceRoot), {
      model: "",
      modelProvider: "",
    });
  } finally {
    await adapter.close();
  }
});

test("claudecode process client rejects a different resumed session id", () => {
  const client = new ClaudeCodeProcessClient({
    command: "claude",
    cwd: "/workspace",
    env: {},
  });
  client.pendingTurnId = "turn-resume";
  client.activeThreadId = "33333333-3333-4333-8333-333333333333";
  const events = [];
  client.onMessage((event) => {
    events.push(event);
  });

  client.handleLine(JSON.stringify({
    type: "system",
    session_id: "44444444-4444-4444-8444-444444444444",
  }));

  assert.deepEqual(events.map((event) => event.type), ["process.error"]);
  assert.equal(events[0].sessionId, "33333333-3333-4333-8333-333333333333");
  assert.match(events[0].error, /unexpected session id/);
  assert.equal(client.sessionId, "");
});

test("claudecode process client rejects a different session id before the next turn", () => {
  const client = new ClaudeCodeProcessClient({
    command: "claude",
    cwd: "/workspace",
    env: {},
  });
  client.resumeSessionId = "55555555-5555-4555-8555-555555555555";
  const events = [];
  client.onMessage((event) => {
    events.push(event);
  });

  client.handleLine(JSON.stringify({
    type: "system",
    session_id: "66666666-6666-4666-8666-666666666666",
  }));

  assert.deepEqual(events.map((event) => event.type), ["process.error"]);
  assert.equal(events[0].sessionId, "55555555-5555-4555-8555-555555555555");
  assert.equal(events[0].turnId, "");
  assert.equal(client.sessionId, "");
  assert.equal(client.resumeSessionId, "55555555-5555-4555-8555-555555555555");
});

test("handleRuntimeEvent prompts for project shell commands instead of auto-approving them", async () => {
  const prompts = [];
  const appLike = {
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return { bindingKey: "binding-1", workspaceRoot: "/workspace" };
          },
          getApprovalPromptState() {
            return null;
          },
          rememberApprovalPrompt() {},
          getApprovalCommandAllowlistForWorkspace() {
            return [];
          },
        };
      },
      async respondApproval(payload) {
        throw new Error(`should not auto-approve ${JSON.stringify(payload)}`);
      },
    },
    threadStateStore: {
      resolveApproval() {},
    },
    async sendApprovalPrompt(payload) {
      prompts.push(payload);
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread-1",
      requestId: "req-3",
      commandTokens: ["cyberboss", "timeline", "write", "--date", "2026-04-17"],
    },
  });

  assert.equal(prompts.length, 1);
});

test("handleNewCommand asks runtime to start a fresh draft before clearing the saved thread", async () => {
  const calls = [];
  const appLike = {
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      startFreshThreadDraft: async ({ workspaceRoot }) => {
        calls.push(["fresh", workspaceRoot]);
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          clearThreadIdForWorkspace(bindingKey, workspaceRoot) {
            calls.push(["clear", bindingKey, workspaceRoot]);
          },
        };
      },
    },
    channelAdapter: {
      async sendText(payload) {
        calls.push(["send", payload.text]);
      },
    },
  };

  await CyberbossApp.prototype.handleNewCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  });

  assert.deepEqual(calls, [
    ["fresh", "/workspace"],
    ["clear", "binding-1", "/workspace"],
    ["send", "✅ Switched to a fresh thread draft\nworkspace: /workspace"],
  ]);
});

test("handleCompactCommand invokes runtime compaction for the current thread", async () => {
  const calls = [];
  const appLike = {
    pendingOperationByRunKey: new Map(),
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    streamDelivery: {
      queueReplyTargetForThread(threadId, payload) {
        calls.push(["queue", threadId, payload.userId, payload.contextToken, payload.provider]);
      },
    },
    runtimeAdapter: {
      async compactThread(payload) {
        calls.push(["compact", payload.threadId, payload.workspaceRoot, payload.model]);
        return { threadId: payload.threadId, turnId: "turn-1" };
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
          getRuntimeParamsForWorkspace() {
            return { model: "claude-sonnet" };
          },
        };
      },
    },
    channelAdapter: {
      async sendText(payload) {
        calls.push(["send", payload.text]);
      },
    },
  };

  await CyberbossApp.prototype.handleCompactCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    provider: "weixin",
  });

  assert.deepEqual(calls, [
    ["queue", "thread-1", "user-1", "ctx-1", "weixin"],
    ["compact", "thread-1", "/workspace", "claude-sonnet"],
    ["send", "🗜️ Compact request sent\nthread: thread-1"],
  ]);
  assert.equal(appLike.pendingOperationByRunKey.get("thread-1:turn-1")?.kind, "compact");
});

test("handleCompactCommand reports when there is no active thread", async () => {
  const calls = [];
  const appLike = {
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "";
          },
        };
      },
    },
    channelAdapter: {
      async sendText(payload) {
        calls.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleCompactCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  });

  assert.deepEqual(calls, [
    "💡 There is no active thread yet. Send a normal message first.",
  ]);
});

test("handleStopCommand passes workspaceRoot through to runtime cancellation", async () => {
  const calls = [];
  const appLike = {
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    threadStateStore: {
      getThreadState(threadId) {
        calls.push(["state", threadId]);
        return {
          threadId,
          turnId: "turn-1",
          status: "running",
        };
      },
    },
    runtimeAdapter: {
      async cancelTurn(payload) {
        calls.push(["cancel", payload.threadId, payload.turnId, payload.workspaceRoot]);
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
        };
      },
    },
    channelAdapter: {
      async sendText(payload) {
        calls.push(["send", payload.text]);
      },
    },
  };

  await CyberbossApp.prototype.handleStopCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  });

  assert.deepEqual(calls, [
    ["state", "thread-1"],
    ["cancel", "thread-1", "turn-1", "/workspace"],
    ["send", "⏹️ Stop request sent\nthread: thread-1"],
  ]);
});

test("handleStopCommand allows stopping while waiting for approval", async () => {
  const calls = [];
  const appLike = {
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    threadStateStore: {
      getThreadState() {
        return {
          threadId: "thread-1",
          turnId: "turn-1",
          status: "waiting_approval",
        };
      },
    },
    runtimeAdapter: {
      async cancelTurn(payload) {
        calls.push(payload);
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
        };
      },
    },
    channelAdapter: {
      async sendText(payload) {
        calls.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleStopCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  });

  assert.equal(calls[0].workspaceRoot, "/workspace");
  assert.equal(calls[1], "⏹️ Stop request sent\nthread: thread-1");
});

test("handleRuntimeEvent reports compact completion back to WeChat", async () => {
  const sent = [];
  const appLike = {
    pendingOperationByRunKey: new Map([
      ["thread-1:turn-1", {
        kind: "compact",
        userId: "user-1",
        contextToken: "ctx-1",
      }],
    ]),
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return null;
          },
        };
      },
    },
    turnGateStore: {
      releaseThread() {},
      isPending() {
        return false;
      },
    },
    hasPendingInboundMessage() {
      return false;
    },
    async flushPendingInboundMessages() {},
    async flushPendingSystemMessages() {},
    async stopTypingForThread() {},
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });

  assert.deepEqual(sent, ["✅ Compact finished\nthread: thread-1"]);
  assert.equal(appLike.pendingOperationByRunKey.size, 0);
});
test("handleRuntimeEvent auto-approves built-in view_image approvals without prompting", async () => {
  const responses = [];
  const appLike = {
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return { bindingKey: "binding-1", workspaceRoot: "/workspace" };
          },
          getApprovalCommandAllowlistForWorkspace() {
            return [];
          },
        };
      },
      async respondApproval(payload) {
        responses.push(payload);
      },
    },
    threadStateStore: {
      resolveApproval() {},
    },
    async sendApprovalPrompt() {
      throw new Error("should not prompt for view_image");
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread-1",
      requestId: "req-img-2",
      commandTokens: ["view_image"],
    },
  });

  assert.deepEqual(responses, [{ requestId: "req-img-2", decision: "accept" }]);
});

test("handleRuntimeEvent auto-approves project-native MCP tool approvals without prompting", async () => {
  const responses = [];
  const appLike = {
    config: { stateDir: path.join(os.tmpdir(), "cyberboss-approval-test") },
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return { bindingKey: "binding-1", workspaceRoot: "/workspace" };
          },
          getApprovalCommandAllowlistForWorkspace() {
            return [];
          },
        };
      },
      async respondApproval(payload) {
        responses.push(payload);
      },
    },
    threadStateStore: {
      resolveApproval() {},
    },
    async sendApprovalPrompt() {
      throw new Error("should not prompt for project-native MCP tools");
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread-1",
      requestId: "req-project-tool",
      commandTokens: ["mcp_tool", "cyberboss_tools", "cyberboss_timeline_write"],
    },
  });

  assert.deepEqual(responses, [{ requestId: "req-project-tool", decision: "accept" }]);
});

test("handleRuntimeEvent auto-approves inbox image reads for claudecode without prompting", async () => {
  const responses = [];
  const stateDir = path.join(os.tmpdir(), "cyberboss-approval-test");
  const appLike = {
    config: { stateDir },
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return { bindingKey: "binding-1", workspaceRoot: "/workspace" };
          },
          getApprovalCommandAllowlistForWorkspace() {
            return [];
          },
        };
      },
      async respondApproval(payload) {
        responses.push(payload);
      },
    },
    threadStateStore: {
      resolveApproval() {},
    },
    async sendApprovalPrompt() {
      throw new Error("should not prompt for inbox image read");
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread-1",
      requestId: "req-read-img-2",
      filePath: path.join(stateDir, "inbox", "2026-04-17", "attachment.jpg"),
      commandTokens: ["read_image"],
    },
  });

  assert.deepEqual(responses, [{ requestId: "req-read-img-2", decision: "accept" }]);
});

test("handleRuntimeEvent auto-approves any state-dir file operation without prompting", async () => {
  const responses = [];
  const stateDir = path.join(os.tmpdir(), "cyberboss-approval-test");
  const appLike = {
    config: { stateDir },
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return { bindingKey: "binding-1", workspaceRoot: "/workspace" };
          },
          getApprovalCommandAllowlistForWorkspace() {
            return [];
          },
        };
      },
      async respondApproval(payload) {
        responses.push(payload);
      },
    },
    threadStateStore: {
      resolveApproval() {},
    },
    async sendApprovalPrompt() {
      throw new Error("should not prompt for state-dir file operation");
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread-1",
      requestId: "req-write-2",
      filePath: path.join(stateDir, "notes", "today.md"),
      filePaths: [path.join(stateDir, "notes", "today.md")],
      commandTokens: [],
      reason: "Tool: Write",
      command: "Write\nfile_path: \"/tmp/cyberboss-approval-test/notes/today.md\"",
    },
  });

  assert.deepEqual(responses, [{ requestId: "req-write-2", decision: "accept" }]);
});

test("handleRuntimeEvent still prompts for non-inbox image reads", async () => {
  const responses = [];
  const prompts = [];
  const stateDir = path.join(os.tmpdir(), "cyberboss-approval-test");
  const appLike = {
    config: { stateDir },
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return { bindingKey: "binding-1", workspaceRoot: "/workspace" };
          },
          getApprovalCommandAllowlistForWorkspace() {
            return [];
          },
          getApprovalPromptState() {
            return null;
          },
          rememberApprovalPrompt() {},
        };
      },
      async respondApproval(payload) {
        responses.push(payload);
      },
    },
    threadStateStore: {
      resolveApproval() {},
    },
    async sendApprovalPrompt(payload) {
      prompts.push(payload);
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread-1",
      requestId: "req-read-img-3",
      filePath: "/Users/tingyiwen/Desktop/photo.jpg",
      commandTokens: ["read_image"],
      reason: "Tool: Read",
      command: "Read\nfile_path: \"/Users/tingyiwen/Desktop/photo.jpg\"",
    },
  });

  assert.deepEqual(responses, []);
  assert.equal(prompts.length, 1);
});

test("handleRuntimeEvent auto-approves allowlisted prefixes for claudecode approvals", async () => {
  const responses = [];
  const appLike = {
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return { bindingKey: "binding-1", workspaceRoot: "/workspace" };
          },
          getApprovalCommandAllowlistForWorkspace() {
            return [["npm", "run", "timeline:build"]];
          },
        };
      },
      async respondApproval(payload) {
        responses.push(payload);
      },
    },
    threadStateStore: {
      resolveApproval() {},
    },
    async sendApprovalPrompt() {
      throw new Error("should not prompt for allowlisted commands");
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread-1",
      requestId: "req-4",
      commandTokens: ["npm", "run", "timeline:build", "--", "--locale", "en"],
    },
  });

  assert.deepEqual(responses, [{ requestId: "req-4", decision: "accept" }]);
});

test("handleRuntimeEvent auto-approves allowlisted MCP tool approvals", async () => {
  const responses = [];
  const appLike = {
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return { bindingKey: "binding-1", workspaceRoot: "/workspace" };
          },
          getApprovalCommandAllowlistForWorkspace() {
            return [["mcp_tool", "cyberboss_tools", "cyberboss_timeline_write"]];
          },
        };
      },
      async respondApproval(payload) {
        responses.push(payload);
      },
    },
    threadStateStore: {
      resolveApproval() {},
    },
    async sendApprovalPrompt() {
      throw new Error("should not prompt for allowlisted MCP tools");
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread-1",
      requestId: "req-mcp-allow",
      commandTokens: ["mcp_tool", "cyberboss_tools", "cyberboss_timeline_write"],
    },
  });

  assert.deepEqual(responses, [{ requestId: "req-mcp-allow", decision: "accept" }]);
});

test("handleSwitchCommand stores the verified claudecode thread returned by runtime", async () => {
  const calls = [];
  const appLike = {
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      describe() {
        return { id: "claudecode" };
      },
      async resumeThread({ threadId, workspaceRoot }) {
        calls.push(["resume", threadId, workspaceRoot]);
        return { threadId: "actual-thread" };
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getRuntimeParamsForWorkspace() {
            return { model: "claude-sonnet", modelProvider: "" };
          },
          setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId) {
            calls.push(["set", bindingKey, workspaceRoot, threadId]);
          },
        };
      },
    },
    channelAdapter: {
      async sendText(payload) {
        calls.push(["send", payload.text]);
      },
    },
  };

  await CyberbossApp.prototype.handleSwitchCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  }, {
    args: "target-thread",
  });

  assert.deepEqual(calls, [
    ["resume", "target-thread", "/workspace"],
    ["set", "binding-1", "/workspace", "actual-thread"],
    ["send", "✅ Thread switched\nworkspace: /workspace\nthread: actual-thread"],
  ]);
});

test("session store does not reuse legacy thread ids across runtimes", () => {
  const sessionsFile = path.join(
    os.tmpdir(),
    `cyberboss-session-store-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  fs.writeFileSync(sessionsFile, JSON.stringify({
    bindings: {
      "binding-1": {
        activeWorkspaceRoot: "/workspace",
        threadIdByWorkspaceRoot: {
          "/workspace": "codex-thread",
        },
      },
    },
  }, null, 2));

  const claudecodeStore = new SessionStore({ filePath: sessionsFile, runtimeId: "claudecode" });
  const codexStore = new SessionStore({ filePath: sessionsFile, runtimeId: "codex" });

  assert.equal(claudecodeStore.getThreadIdForWorkspace("binding-1", "/workspace"), "");
  assert.equal(codexStore.getThreadIdForWorkspace("binding-1", "/workspace"), "");
});

test("codex session store reads runtime-scoped thread ids", () => {
  const sessionsFile = path.join(
    os.tmpdir(),
    `cyberboss-codex-runtime-scoped-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  fs.writeFileSync(sessionsFile, JSON.stringify({
    bindings: {
      "binding-1": {
        activeWorkspaceRoot: "/workspace",
        threadIdByWorkspaceRootByRuntime: {
          codex: {
            "/workspace": "codex-thread",
          },
        },
      },
    },
  }, null, 2));

  const codexStore = new SessionStore({ filePath: sessionsFile, runtimeId: "codex" });

  assert.equal(codexStore.getThreadIdForWorkspace("binding-1", "/workspace"), "codex-thread");
  assert.deepEqual(codexStore.listWorkspaceRoots("binding-1"), ["/workspace"]);
  assert.deepEqual(codexStore.findBindingForThreadId("codex-thread"), {
    bindingKey: "binding-1",
    workspaceRoot: "/workspace",
  });
});

test("codex session store does not reuse legacy thread ids without runtime-scoped binding", () => {
  const sessionsFile = path.join(
    os.tmpdir(),
    `cyberboss-codex-thread-store-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  fs.writeFileSync(sessionsFile, JSON.stringify({
    bindings: {
      "binding-1": {
        activeWorkspaceRoot: "/workspace",
        threadIdByWorkspaceRoot: {
          "/workspace": "legacy-codex-thread",
        },
      },
    },
  }, null, 2));

  const codexStore = new SessionStore({ filePath: sessionsFile, runtimeId: "codex" });

  assert.equal(codexStore.getThreadIdForWorkspace("binding-1", "/workspace"), "");
  assert.deepEqual(codexStore.listWorkspaceRoots("binding-1"), []);
  assert.equal(codexStore.findBindingForThreadId("legacy-codex-thread"), null);
});

test("handleStatusCommand asks to configure claudecode context window before showing context", async () => {
  const sent = [];
  const appLike = {
    config: {
      claudeModel: "claude-sonnet",
    },
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      describe() {
        return { id: "claudecode" };
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
          getRuntimeParamsForWorkspace() {
            return { model: "" };
          },
        };
      },
    },
    threadStateStore: {
      getThreadState() {
        return { status: "idle" };
      },
      getLatestContext() {
        return {
          runtimeId: "claudecode",
          currentTokens: 18000,
        };
      },
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleStatusCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  });

  assert.match(sent[0], /📦 context: set CYBERBOSS_CLAUDE_CONTEXT_WINDOW/);
});

test("handleStatusCommand shows approximate context details for claudecode when configured", async () => {
  const sent = [];
  const appLike = {
    config: {
      claudeContextWindow: 130000,
      claudeMaxOutputTokens: 64000,
    },
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      describe() {
        return { id: "claudecode" };
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
          getRuntimeParamsForWorkspace() {
            return { model: "kimi-for-coding" };
          },
        };
      },
    },
    threadStateStore: {
      getThreadState() {
        return {
          status: "idle",
          context: {
            runtimeId: "claudecode",
            currentTokens: 18000,
          },
        };
      },
      getLatestContext() {
        return null;
      },
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleStatusCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  });

  assert.match(sent[0], /📦 context: approx 18k\/66k \| 73% left \| reserve 64k/);
});

test("handleStatusCommand asks to reduce claudecode max output tokens when reserve exceeds window", async () => {
  const sent = [];
  const appLike = {
    config: {
      claudeContextWindow: 130000,
      claudeMaxOutputTokens: 140000,
    },
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      describe() {
        return { id: "claudecode" };
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
          getRuntimeParamsForWorkspace() {
            return { model: "kimi-for-coding" };
          },
        };
      },
    },
    threadStateStore: {
      getThreadState() {
        return {
          status: "idle",
          context: {
            runtimeId: "claudecode",
            currentTokens: 18000,
          },
        };
      },
      getLatestContext() {
        return null;
      },
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleStatusCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  });

  assert.match(sent[0], /📦 context: reduce CLAUDE_CODE_MAX_OUTPUT_TOKENS/);
});

test("handleStatusCommand shows codex context details", async () => {
  const sent = [];
  const appLike = {
    config: {},
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      describe() {
        return { id: "codex" };
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
          getRuntimeParamsForWorkspace() {
            return { model: "gpt-5.4" };
          },
        };
      },
    },
    threadStateStore: {
      getThreadState() {
        return { status: "idle" };
      },
      getLatestContext() {
        return {
          runtimeId: "codex",
          currentTokens: 1234,
          contextWindow: 200000,
        };
      },
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleStatusCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  });

  assert.match(sent[0], /📦 context: 1.2k\/200k \| 99% left/);
});

test("handleStatusCommand shows codex context as unavailable when no context data is available", async () => {
  const sent = [];
  const appLike = {
    config: {},
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      describe() {
        return { id: "codex" };
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
          getRuntimeParamsForWorkspace() {
            return { model: "gpt-5.4" };
          },
        };
      },
    },
    threadStateStore: {
      getThreadState() {
        return { status: "idle" };
      },
      getLatestContext() {
        return null;
      },
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleStatusCommand.call(appLike, {
    workspaceId: "default",
    accountId: "account-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  });

  assert.match(sent[0], /📦 context: unavailable/);
});

async function waitForFileText(filePath, pattern, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, "utf8");
      if (!pattern || pattern.test(text)) {
        return text;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}
