const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const {
  SAFE_BETA_WEIXIN_CARRIER,
  buildHandoffDeveloperInstructions,
  loadHandoffBootstrap,
} = require("../src/core/handoff-bootstrap");
const { buildStartThreadParams } = require("../src/adapters/runtime/codex/rpc-client");
const { createCodexRuntimeAdapter } = require("../src/adapters/runtime/codex");

function createDatabase(rows = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-handoff-bootstrap-"));
  const databasePath = path.join(directory, "memory.sqlite3");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE handoffs (
      handoff_id TEXT PRIMARY KEY,
      source_carrier TEXT NOT NULL,
      target_carrier TEXT NOT NULL,
      source_session TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  const insert = database.prepare(`
    INSERT INTO handoffs(
      handoff_id, source_carrier, target_carrier, source_session,
      summary, created_at, expires_at
    ) VALUES (?, ?, ?, '', ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      row.handoffId,
      row.sourceCarrier || "codex",
      row.targetCarrier || "weixin",
      row.summary,
      row.createdAt,
      row.expiresAt,
    );
  }
  database.close();
  return { directory, databasePath };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("valid codex to weixin handoff becomes provenance-labelled developer context", () => {
  const fixture = createDatabase([{
    handoffId: "handoff-valid",
    summary: "Safe reviewed handoff summary.",
    createdAt: "2026-08-07T00:00:00.000Z",
    expiresAt: "2026-08-07T01:00:00.000Z",
  }]);
  const result = loadHandoffBootstrap({
    databasePath: fixture.databasePath,
    targetCarrier: SAFE_BETA_WEIXIN_CARRIER,
    now: new Date("2026-08-07T00:10:00.000Z"),
  });

  assert.equal(result.status, "found");
  assert.equal(result.handoff.targetCarrier, "weixin");
  const developerInstructions = buildHandoffDeveloperInstructions(result);
  assert.match(developerInstructions, /not user-authored/i);
  assert.match(developerInstructions, /handoff-valid/);
  assert.match(developerInstructions, /Safe reviewed handoff summary/);

  const params = buildStartThreadParams({
    cwd: fixture.directory,
    developerInstructions,
  });
  assert.equal(params.developerInstructions, developerInstructions);
  assert.equal(Object.hasOwn(params, "input"), false);
});

test("expired handoff degrades to unknown without exposing stale summary", () => {
  const fixture = createDatabase([{
    handoffId: "handoff-expired",
    summary: "STALE_UNIQUE_SUMMARY",
    createdAt: "2026-08-07T00:00:00.000Z",
    expiresAt: "2026-08-07T00:30:00.000Z",
  }]);
  const result = loadHandoffBootstrap({
    databasePath: fixture.databasePath,
    targetCarrier: "weixin",
    now: new Date("2026-08-07T00:30:00.000Z"),
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.reason, "expired");
  assert.equal(JSON.stringify(result).includes("STALE_UNIQUE_SUMMARY"), false);
});

test("handoff with insufficient remaining TTL degrades to unknown", () => {
  const fixture = createDatabase([{
    handoffId: "handoff-near-expiry",
    summary: "Near expiry summary.",
    createdAt: "2026-08-07T00:00:00.000Z",
    expiresAt: "2026-08-07T00:10:30.000Z",
  }]);
  const result = loadHandoffBootstrap({
    databasePath: fixture.databasePath,
    targetCarrier: "weixin",
    now: new Date("2026-08-07T00:10:00.000Z"),
    minRemainingSeconds: 60,
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.reason, "insufficient_ttl");
});

test("wechat is rejected as an invalid carrier instead of being aliased", () => {
  const fixture = createDatabase([]);
  const result = loadHandoffBootstrap({
    databasePath: fixture.databasePath,
    targetCarrier: "wechat",
    now: new Date("2026-08-07T00:00:00.000Z"),
  });

  assert.equal(result.status, "invalid_carrier");
  assert.equal(result.reason, "invalid_carrier");
});

test("malformed handoff degrades to unknown and does not inject content", () => {
  const fixture = createDatabase([{
    handoffId: "handoff-malformed",
    summary: "Malformed timestamp summary.",
    createdAt: "not-a-time",
    expiresAt: "also-not-a-time",
  }]);
  const result = loadHandoffBootstrap({
    databasePath: fixture.databasePath,
    targetCarrier: "weixin",
    now: new Date("2026-08-07T00:00:00.000Z"),
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.reason, "malformed");
  assert.equal(JSON.stringify(result).includes("Malformed timestamp summary"), false);
});

test("unknown bootstrap is labelled as runtime context and contains no handoff body", () => {
  const developerInstructions = buildHandoffDeveloperInstructions({
    status: "unknown",
    reason: "missing",
    targetCarrier: "weixin",
  });

  assert.match(developerInstructions, /not user-authored/i);
  assert.match(developerInstructions, /status: unknown/i);
  assert.equal(developerInstructions.includes("safe_summary"), false);
});

test("bootstrap read does not mutate SQLite content or file bytes", () => {
  const fixture = createDatabase([{
    handoffId: "handoff-read-only",
    summary: "Read-only boundary summary.",
    createdAt: "2026-08-07T00:00:00.000Z",
    expiresAt: "2026-08-07T01:00:00.000Z",
  }]);
  const before = sha256(fixture.databasePath);
  const result = loadHandoffBootstrap({
    databasePath: fixture.databasePath,
    targetCarrier: "weixin",
    now: new Date("2026-08-07T00:10:00.000Z"),
  });
  const after = sha256(fixture.databasePath);

  assert.equal(result.status, "found");
  assert.equal(after, before);
  assert.equal(fs.existsSync(`${fixture.databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${fixture.databasePath}-shm`), false);
});

test("new Codex thread receives handoff once as developer instructions", async () => {
  const fixture = createDatabase([]);
  const sessionsFile = path.join(fixture.directory, "sessions.json");
  const cursorFile = path.join(fixture.directory, "sync-buffer.txt");
  fs.writeFileSync(cursorFile, "CURSOR_SENTINEL", "utf8");
  const cursorBefore = sha256(cursorFile);
  const pythonPath = path.join(fixture.directory, "python.exe");
  fs.writeFileSync(pythonPath, "test", "utf8");
  const memoryRoot = path.join(fixture.directory, "memory-agent");
  fs.mkdirSync(path.join(memoryRoot, "src", "memory_agent"), { recursive: true });
  fs.writeFileSync(path.join(memoryRoot, "src", "memory_agent", "mcp_server.py"), "", "utf8");

  const clients = [];
  class FakeCodexRpcClient {
    constructor() {
      this.isReady = true;
      this.startCalls = [];
      this.sendCalls = [];
      this.resumeCalls = [];
      clients.push(this);
    }
    isTransportReady() { return true; }
    onMessage() { return () => {}; }
    async connect() {}
    async initialize() {}
    async listModels() { return { result: { data: [] } }; }
    async startThread(params) {
      this.startCalls.push(params);
      return { result: { thread: { id: "thread-safe" } } };
    }
    async resumeThread(params) { this.resumeCalls.push(params); }
    async sendUserMessage(params) {
      this.sendCalls.push(params);
      return { result: { turn: { id: `turn-${this.sendCalls.length}` } } };
    }
    async close() {}
  }

  let bootstrapLoads = 0;
  const adapter = createCodexRuntimeAdapter({
    safeBeta: true,
    sessionsFile,
    memoryPythonPath: pythonPath,
    memoryAgentRoot: memoryRoot,
    memoryDatabasePath: fixture.databasePath,
    codexModel: "",
    codexModelProvider: "",
    stateDir: fixture.directory,
  }, {
    CodexRpcClient: FakeCodexRpcClient,
    loadHandoffBootstrap() {
      bootstrapLoads += 1;
      return {
        status: "found",
        targetCarrier: "weixin",
        handoff: {
          handoffId: "handoff-runtime",
          sourceCarrier: "codex",
          targetCarrier: "weixin",
          sourceSession: "",
          safeSummary: "RUNTIME_UNIQUE_HANDOFF",
          createdAt: "2026-08-07T00:00:00.000Z",
          expiresAt: "2026-08-07T01:00:00.000Z",
          remainingSeconds: 3600,
          source: "local_ephemeral_ttl_handoff",
        },
      };
    },
  });

  await adapter.sendTurn({
    bindingKey: "binding",
    workspaceRoot: fixture.directory,
    text: "first user message",
  });
  await adapter.sendTurn({
    bindingKey: "binding",
    workspaceRoot: fixture.directory,
    text: "second user message",
  });

  assert.equal(bootstrapLoads, 1);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].startCalls.length, 1);
  assert.match(clients[0].startCalls[0].developerInstructions, /RUNTIME_UNIQUE_HANDOFF/);
  assert.match(clients[0].startCalls[0].developerInstructions, /not user-authored/i);
  assert.equal(clients[0].sendCalls.length, 2);
  assert.equal(clients[0].sendCalls[0].text.includes("RUNTIME_UNIQUE_HANDOFF"), false);
  assert.equal(clients[0].sendCalls[1].text.includes("RUNTIME_UNIQUE_HANDOFF"), false);
  assert.equal(sha256(cursorFile), cursorBefore);
});
