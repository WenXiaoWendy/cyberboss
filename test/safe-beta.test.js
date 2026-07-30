const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  SAFE_MEMORY_TOOLS,
  assertSafeBetaStartAllowed,
  buildMinimalMemoryMcpEnv,
  isSafeBetaEnabled,
  resolveSafeBetaConfig,
  validateMemoryMcpPaths,
} = require("../src/core/safe-beta");
const { createInboundFilter } = require("../src/adapters/channel/weixin/message-utils");
const {
  buildCodexMcpConfigArgs,
  resolveSafeBetaMemoryMcpServerConfig,
} = require("../src/adapters/runtime/codex/mcp-config");
const {
  buildTurnStartParams,
} = require("../src/adapters/runtime/codex/rpc-client");
const { buildSharedStartArgs } = require("../scripts/shared-start");
const { buildSafeBetaDryRunReport } = require("../scripts/safe-beta-dry-run");
const { loadCyberbossEnv } = require("../src/core/env-loader");
const { CyberbossApp } = require("../src/core/app");

function textMessage(senderId = "allowed-user") {
  return {
    message_type: 1,
    from_user_id: senderId,
    message_id: `${Date.now()}-${Math.random()}`,
    item_list: [{ type: 1, text_item: { text: "hello" } }],
  };
}

test("safe beta only accepts normalized true", () => {
  for (const value of ["true", " TRUE ", "True"]) {
    assert.equal(isSafeBetaEnabled(value), true);
  }
  for (const value of ["1", "yes", "on", "false", "", undefined]) {
    assert.equal(isSafeBetaEnabled(value), false);
  }
});

test("empty allowlist rejects start and shared:start but login is the only exception", () => {
  for (const allowedUserIds of [[], [" "], null]) {
    assert.throws(
      () => assertSafeBetaStartAllowed({ safeBeta: true, mode: "start", allowedUserIds }),
      /allowlist/i,
    );
  }
  assert.doesNotThrow(
    () => assertSafeBetaStartAllowed({ safeBeta: true, mode: "login", allowedUserIds: [] }),
  );
});

test("unauthorized sender is rejected before media inspection", () => {
  let inspected = false;
  const message = textMessage("blocked-user");
  Object.defineProperty(message, "item_list", {
    get() {
      inspected = true;
      throw new Error("media was inspected");
    },
  });
  const filter = createInboundFilter();
  const result = filter.normalize(message, {
    safeBeta: true,
    allowedUserIds: ["allowed-user"],
    workspaceId: "default",
  }, "account");
  assert.equal(result, null);
  assert.equal(inspected, false);
});

test("authorized plain text passes safe ingress", () => {
  const filter = createInboundFilter();
  const result = filter.normalize(textMessage(), {
    safeBeta: true,
    allowedUserIds: ["allowed-user"],
    workspaceId: "default",
  }, "account");
  assert.equal(result.text, "hello");
  assert.deepEqual(result.attachments, []);
});

test("all non-text item types are rejected before attachment extraction", () => {
  for (const type of [2, 3, 4, 5, 6, 7, 8, 9, 99]) {
    const filter = createInboundFilter();
    const message = textMessage();
    message.item_list = [{ type, image_item: { media: { download_url: "never-read" } } }];
    assert.equal(filter.normalize(message, {
      safeBeta: true,
      allowedUserIds: ["allowed-user"],
      workspaceId: "default",
    }, "account"), null);
  }
});

test("known group and public conversation markers are rejected", () => {
  for (const marker of [
    { chat_type: "group" },
    { conversation_type: 2 },
    { group_id: "group" },
    { chatroom_id: "room" },
    { is_group: true },
    { is_public_account: true },
  ]) {
    const filter = createInboundFilter();
    assert.equal(filter.normalize({ ...textMessage(), ...marker }, {
      safeBeta: true,
      allowedUserIds: ["allowed-user"],
      workspaceId: "default",
    }, "account"), null);
  }
});

test("safe shared start never adds checkin", () => {
  assert.deepEqual(buildSharedStartArgs({ safeBeta: true }), [
    "./bin/cyberboss.js",
    "start",
  ]);
});

test("safe configuration force-disables active and privileged capabilities", () => {
  const config = resolveSafeBetaConfig({
    safeBeta: true,
    startWithCheckin: true,
    startWithLocationServer: true,
    enableRandomWake: true,
    enableSystemMessages: true,
    enableProjectTools: true,
    visionMode: "auto",
  });
  assert.equal(config.startWithCheckin, false);
  assert.equal(config.startWithLocationServer, false);
  assert.equal(config.enableRandomWake, false);
  assert.equal(config.enableSystemMessages, false);
  assert.equal(config.enableProjectTools, false);
  assert.equal(config.visionMode, "off");
});

test("safe Memory MCP tool set is exact and excludes handoff", () => {
  assert.deepEqual(SAFE_MEMORY_TOOLS, [
    "breath",
    "recall",
    "get_source",
    "memory_trigger",
    "ferry",
  ]);
  assert.equal(SAFE_MEMORY_TOOLS.includes("handoff"), false);
});

test("safe Memory MCP is required and project tools are absent", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-mcp-"));
  const python = path.join(temp, "python.exe");
  const root = path.join(temp, "memory-agent");
  const database = path.join(temp, "memory.sqlite3");
  fs.writeFileSync(python, "");
  fs.mkdirSync(path.join(root, "src", "memory_agent"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "memory_agent", "mcp_server.py"), "");
  fs.writeFileSync(database, "");
  const server = resolveSafeBetaMemoryMcpServerConfig({
    pythonPath: python,
    memoryAgentRoot: root,
    databasePath: database,
  });
  assert.equal(server.name, "xingxing-memory");
  assert.equal(server.required, true);
  assert.deepEqual(server.enabledTools, SAFE_MEMORY_TOOLS);
  assert.equal(buildCodexMcpConfigArgs(server).some((arg) => arg.includes("cyberboss_tools")), false);
  assert.equal(buildCodexMcpConfigArgs(server).some((arg) => arg.includes("handoff")), false);
});

test("safe Codex turn payload is read-only, on-request and non-networked", () => {
  const params = buildTurnStartParams({
    threadId: "thread",
    input: [{ type: "text", text: "hello" }],
    accessMode: "full-access",
    workspaceRoot: "C:\\workspace",
    extraWritableRoots: ["C:\\state"],
    safeBeta: true,
  });
  assert.equal(params.approvalPolicy, "on-request");
  assert.deepEqual(params.sandboxPolicy, { type: "readOnly" });
  assert.notEqual(params.sandboxPolicy.type, "workspaceWrite");
  assert.notEqual(params.sandboxPolicy.type, "dangerFullAccess");
  assert.notEqual(params.approvalPolicy, "never");
  assert.equal(params.sandboxPolicy.networkAccess, undefined);
});

test("safe Codex configuration rejects malformed execution policy instead of falling back", () => {
  assert.throws(() => buildTurnStartParams({
    threadId: "thread",
    input: [],
    safeBeta: true,
    safeExecutionPolicy: { sandboxPolicy: null },
  }), /safe beta codex policy/i);
});

test("custom state env has priority and default state directory is untouched", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-env-"));
  const cwd = path.join(temp, "cwd");
  const custom = path.join(temp, "custom");
  const defaultState = path.join(temp, "default");
  fs.mkdirSync(cwd);
  fs.mkdirSync(custom);
  fs.writeFileSync(path.join(cwd, ".env"), [
    `CYBERBOSS_STATE_DIR=${custom}`,
    "CYBERBOSS_USER_NAME=from-cwd",
  ].join("\n"));
  fs.writeFileSync(path.join(custom, ".env"), "CYBERBOSS_USER_NAME=from-custom\n");
  const env = loadCyberbossEnv({ cwd, defaultStateDir: defaultState, baseEnv: {} });
  assert.equal(env.CYBERBOSS_USER_NAME, "from-custom");
  assert.equal(env.CYBERBOSS_STATE_DIR, custom);
  assert.equal(fs.existsSync(defaultState), false);
});

test("missing Python, Memory Agent, SQLite, or MCP module fails preflight", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-preflight-"));
  const valid = {
    pythonPath: path.join(temp, "python.exe"),
    memoryAgentRoot: path.join(temp, "agent"),
    databasePath: path.join(temp, "memory.sqlite3"),
  };
  fs.writeFileSync(valid.pythonPath, "");
  fs.mkdirSync(path.join(valid.memoryAgentRoot, "src", "memory_agent"), { recursive: true });
  fs.writeFileSync(path.join(valid.memoryAgentRoot, "src", "memory_agent", "mcp_server.py"), "");
  fs.writeFileSync(valid.databasePath, "");
  assert.doesNotThrow(() => validateMemoryMcpPaths(valid));
  for (const key of Object.keys(valid)) {
    assert.throws(() => validateMemoryMcpPaths({ ...valid, [key]: path.join(temp, `missing-${key}`) }), /missing/i);
  }
  fs.rmSync(path.join(valid.memoryAgentRoot, "src", "memory_agent", "mcp_server.py"));
  assert.throws(() => validateMemoryMcpPaths(valid), /mcp module/i);
});

test("Memory MCP child environment excludes Notion and unrelated secrets", () => {
  const env = buildMinimalMemoryMcpEnv({
    PATH: "safe-path",
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\Temp",
    NOTION_TOKEN: "never",
    OPENAI_API_KEY: "never",
    CYBERBOSS_SECRET: "never",
  }, "C:\\agent\\src");
  assert.equal(env.PATH, "safe-path");
  assert.equal(env.PYTHONPATH, "C:\\agent\\src");
  assert.equal("NOTION_TOKEN" in env, false);
  assert.equal("OPENAI_API_KEY" in env, false);
  assert.equal("CYBERBOSS_SECRET" in env, false);
});

test("safe restrictions cannot be overridden by ordinary configuration", () => {
  const config = resolveSafeBetaConfig({
    safeBeta: true,
    startWithCheckin: "true",
    startWithLocationServer: "true",
    enableProjectTools: "true",
    codexAccessMode: "full-access",
  });
  assert.equal(config.startWithCheckin, false);
  assert.equal(config.startWithLocationServer, false);
  assert.equal(config.enableProjectTools, false);
  assert.equal(config.codexAccessMode, "read-only");
  assert.equal(config.runtime, "codex");
});

test("ferry is auto only after its SQLite boundary verification", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-ferry-"));
  const python = path.join(temp, "python.exe");
  const root = path.join(temp, "memory-agent");
  const database = path.join(temp, "memory.sqlite3");
  fs.writeFileSync(python, "");
  fs.mkdirSync(path.join(root, "src", "memory_agent"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "memory_agent", "mcp_server.py"), "");
  fs.writeFileSync(database, "");
  const server = resolveSafeBetaMemoryMcpServerConfig({
    pythonPath: python,
    memoryAgentRoot: root,
    databasePath: database,
  });
  assert.equal(server.approvalModeByTool.ferry, "auto");
  for (const tool of SAFE_MEMORY_TOOLS) {
    assert.equal(server.approvalModeByTool[tool], "auto");
  }
});

test("safe dry-run starts no process and exposes no active capability", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-dry-run-"));
  const python = path.join(temp, "python.exe");
  const root = path.join(temp, "memory-agent");
  const database = path.join(temp, "memory.sqlite3");
  fs.writeFileSync(python, "");
  fs.mkdirSync(path.join(root, "src", "memory_agent"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "memory_agent", "mcp_server.py"), "");
  fs.writeFileSync(database, "");
  const report = buildSafeBetaDryRunReport({
    CYBERBOSS_SAFE_BETA: "true",
    CYBERBOSS_ALLOWED_USER_IDS: "configured-user",
    CYBERBOSS_STATE_DIR: path.join(temp, "state"),
    CYBERBOSS_MEMORY_PYTHON: python,
    CYBERBOSS_MEMORY_AGENT_ROOT: root,
    CYBERBOSS_MEMORY_SQLITE: database,
  });
  assert.deepEqual(report.processesStarted, []);
  assert.deepEqual(report.networkConnectionsOpened, []);
  assert.deepEqual(report.mcp.servers, ["xingxing-memory"]);
  assert.equal(report.mcp.projectToolsConfigured, false);
  assert.equal(report.mcp.handoffConfigured, false);
  assert.equal(Object.values(report.activeCapabilities).some(Boolean), false);
});

test("safe runtime declines every unexpected Codex approval instead of auto-approving", async () => {
  const responses = [];
  const resolved = [];
  const app = Object.create(CyberbossApp.prototype);
  app.config = { safeBeta: true };
  app.streamDelivery = {
    async handleRuntimeEvent() {},
  };
  app.runtimeAdapter = {
    getSessionStore() {
      return {
        findBindingForThreadId() {
          return { workspaceRoot: "C:\\workspace", bindingKey: "binding" };
        },
      };
    },
    async respondApproval(payload) {
      responses.push(payload);
    },
  };
  app.threadStateStore = {
    resolveApproval(threadId, status) {
      resolved.push({ threadId, status });
    },
  };

  await app.handleRuntimeEvent({
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread",
      requestId: "request",
      commandTokens: ["view_image"],
    },
  });

  assert.deepEqual(responses, [{ requestId: "request", decision: "decline" }]);
  assert.deepEqual(resolved, [{ threadId: "thread", status: "running" }]);
});
