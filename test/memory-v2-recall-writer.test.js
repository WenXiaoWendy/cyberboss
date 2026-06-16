const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const {
  MemoryV2RecallWriter,
} = require("../src/memory-v2/recall-writer");

function createFixture({ migrated = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-recall-writer-"));
  const dbPath = path.join(root, "memory-v2.sqlite");
  const backupDir = path.join(root, "backup");
  fs.mkdirSync(backupDir);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE memory_index (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_message_ids TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_timestamp TEXT NOT NULL,
      source_role TEXT NOT NULL,
      heat REAL NOT NULL,
      last_recalled TEXT,
      pinned INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  if (migrated) {
    db.exec(`
      ALTER TABLE memory_index ADD COLUMN last_recalled_at TEXT;
      ALTER TABLE memory_index ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE memory_recall_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        memory_id TEXT NOT NULL,
        recalled_at TEXT NOT NULL,
        consumer TEXT NOT NULL,
        purpose TEXT NOT NULL,
        source_turn_id TEXT,
        heat_before REAL NOT NULL,
        heat_after REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memory_index(id)
      );
      CREATE INDEX idx_memory_recall_audit_memory_time
        ON memory_recall_audit(memory_id, recalled_at);
    `);
  }
  const columns = new Set(db.prepare("PRAGMA table_info(memory_index)").all()
    .map((row) => row.name));
  const migratedColumns = columns.has("last_recalled_at")
    ? ", last_recalled_at, recall_count"
    : "";
  const migratedValues = columns.has("last_recalled_at") ? ", NULL, 0" : "";
  const insert = db.prepare(`
    INSERT INTO memory_index (
      id, source_key, status, memory_type, title, content,
      source_message_ids, source_file, source_timestamp, source_role,
      heat, last_recalled, pinned, created_at, updated_at
      ${migratedColumns}
    ) VALUES (
      ?, ?, ?, 'conversation', ?, ?, ?, ?, ?, 'user',
      ?, NULL, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      ${migratedValues}
    )
  `);
  insert.run(
    "mem_active",
    "source_active",
    "active",
    "Tea preference",
    "The user likes jasmine tea.",
    '["message_active"]',
    "/l0/active.jsonl",
    "2026-01-01T00:00:00.000Z",
    0.05,
    0,
  );
  insert.run(
    "mem_hot",
    "source_hot",
    "active",
    "Hot memory",
    "This memory is already warm.",
    '["message_hot"]',
    "/l0/hot.jsonl",
    "2026-01-02T00:00:00.000Z",
    2.9,
    1,
  );
  insert.run(
    "mem_pending",
    "source_pending",
    "pending",
    "Pending memory",
    "This memory is still pending.",
    '["message_pending"]',
    "/l0/pending.jsonl",
    "2026-01-03T00:00:00.000Z",
    0.05,
    0,
  );
  db.close();
  return { root, dbPath, backupDir };
}

function backupGate(fixture) {
  return {
    verified: true,
    directory: fixture.backupDir,
    sha256: "a".repeat(64),
  };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function toBeCloseTo(actual, expected, precision = 6) {
  assert.ok(
    Math.abs(actual - expected) < 10 ** -precision,
    `expected ${actual} to be close to ${expected}`,
  );
}

test("directory, metadata, and peek reads are heat-neutral", () => {
  const fixture = createFixture();
  const writer = new MemoryV2RecallWriter({ dbPath: fixture.dbPath });
  const before = sha256(fixture.dbPath);

  const directory = writer.searchDirectory("jasmine tea");
  const metadata = writer.getMetadata("mem_active");
  const body = writer.peekBody("mem_active");

  assert.equal(directory.length, 1);
  assert.equal(Object.hasOwn(directory[0], "content"), false);
  toBeCloseTo(metadata.heat, 0.05);
  assert.equal(body.content, "The user likes jasmine tea.");
  toBeCloseTo(body.heat, 0.05);
  assert.equal(body.recallCount, 0);
  assert.equal(sha256(fixture.dbPath), before);
});

test("recall fails closed unless explicitly enabled with a backup gate", () => {
  const fixture = createFixture();
  const writer = new MemoryV2RecallWriter({ dbPath: fixture.dbPath });
  assert.throws(
    () => writer.recall({
      id: "mem_active",
      eventId: "event_1",
      consumer: "test",
      purpose: "reasoning",
    }),
    /disabled/,
  );
  const enabledWithoutBackup = new MemoryV2RecallWriter({
    dbPath: fixture.dbPath,
    writeEnabled: true,
  });
  assert.throws(
    () => enabledWithoutBackup.recall({
      id: "mem_active",
      eventId: "event_1",
      consumer: "test",
      purpose: "reasoning",
    }),
    /verified backup gate/,
  );
});

test("real recall updates heat, timestamps, count, and audit exactly once", () => {
  const fixture = createFixture();
  const writer = new MemoryV2RecallWriter({
    dbPath: fixture.dbPath,
    writeEnabled: true,
    backupGate: backupGate(fixture),
    now: () => "2026-06-15T10:00:00.000Z",
  });

  const first = writer.recall({
    id: "mem_active",
    eventId: "event_1",
    consumer: "codex",
    purpose: "response_context",
    sourceTurnId: "turn_1",
  });
  const repeated = writer.recall({
    id: "mem_active",
    eventId: "event_1",
    consumer: "codex",
    purpose: "response_context",
    sourceTurnId: "turn_1",
  });

  assert.equal(first.idempotent, false);
  toBeCloseTo(first.memory.heat, 0.35);
  assert.equal(first.memory.lastRecalledAt, "2026-06-15T10:00:00.000Z");
  assert.equal(first.memory.recallCount, 1);
  toBeCloseTo(first.event.heatBefore, 0.05);
  toBeCloseTo(first.event.heatAfter, 0.35);
  assert.equal(repeated.idempotent, true);
  toBeCloseTo(repeated.memory.heat, 0.35);
  assert.equal(repeated.memory.recallCount, 1);
  assert.equal(writer.getRecallAudit("mem_active").length, 1);
});

test("distinct recalls accumulate atomically and cap heat at 3.0", () => {
  const fixture = createFixture();
  let tick = 0;
  const writer = new MemoryV2RecallWriter({
    dbPath: fixture.dbPath,
    writeEnabled: true,
    backupGate: backupGate(fixture),
    now: () => `2026-06-15T10:00:0${tick++}.000Z`,
  });

  writer.recall({
    id: "mem_active",
    eventId: "event_a",
    consumer: "test",
    purpose: "reasoning",
  });
  const second = writer.recall({
    id: "mem_active",
    eventId: "event_b",
    consumer: "test",
    purpose: "reasoning",
  });
  const capped = writer.recall({
    id: "mem_hot",
    eventId: "event_hot",
    consumer: "test",
    purpose: "reasoning",
  });

  toBeCloseTo(second.memory.heat, 0.65);
  assert.equal(second.memory.recallCount, 2);
  toBeCloseTo(capped.memory.heat, 3);
  assert.equal(capped.memory.pinned, true);
});

test("writer rejects pending memories and event reuse across memories", () => {
  const fixture = createFixture();
  const writer = new MemoryV2RecallWriter({
    dbPath: fixture.dbPath,
    writeEnabled: true,
    backupGate: backupGate(fixture),
  });
  assert.throws(
    () => writer.recall({
      id: "mem_pending",
      eventId: "event_pending",
      consumer: "test",
      purpose: "reasoning",
    }),
    /not active/,
  );
  writer.recall({
    id: "mem_active",
    eventId: "event_shared",
    consumer: "test",
    purpose: "reasoning",
  });
  assert.throws(
    () => writer.recall({
      id: "mem_hot",
      eventId: "event_shared",
      consumer: "test",
      purpose: "reasoning",
    }),
    /belongs to another memory/,
  );
});

test("writer refuses an old or partially migrated schema", () => {
  const fixture = createFixture({ migrated: false });
  const writer = new MemoryV2RecallWriter({ dbPath: fixture.dbPath });
  assert.throws(
    () => writer.searchDirectory("tea"),
    /schema is incomplete/,
  );
});
