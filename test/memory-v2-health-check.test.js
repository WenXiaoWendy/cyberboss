const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const {
  runHealthCheck,
  writeReports,
} = require("../scripts/memory-v2-health-check");

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-health-check-"));
  const dbPath = path.join(root, "memory-v2.sqlite");
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
    CREATE TABLE memory_review_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      action TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      next_status TEXT NOT NULL,
      actor TEXT NOT NULL,
      note TEXT NOT NULL,
      memory_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return { root, dbPath, db };
}

function insertMemory(db, overrides = {}) {
  const row = {
    id: "mem_1",
    source_key: "2026-06-01.jsonl:1",
    status: "active",
    memory_type: "conversation",
    title: "A useful memory",
    content: "The user prefers a quiet voice.",
    source_message_ids: '["1"]',
    source_file: "/root/.cyberboss/conversations/2026-06-01.jsonl",
    source_timestamp: "2026-06-01T00:00:00.000Z",
    source_role: "user",
    heat: 0.5,
    last_recalled: null,
    pinned: 0,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
  db.prepare(`
    INSERT INTO memory_index (
      id, source_key, status, memory_type, title, content,
      source_message_ids, source_file, source_timestamp, source_role,
      heat, last_recalled, pinned, created_at, updated_at
    ) VALUES (
      @id, @source_key, @status, @memory_type, @title, @content,
      @source_message_ids, @source_file, @source_timestamp, @source_role,
      @heat, @last_recalled, @pinned, @created_at, @updated_at
    )
  `).run(row);
}

function insertAudit(db, overrides = {}) {
  db.prepare(`
    INSERT INTO memory_review_audit (
      memory_id, action, previous_status, next_status,
      actor, note, memory_snapshot, created_at
    ) VALUES (
      @memory_id, @action, @previous_status, @next_status,
      @actor, @note, @memory_snapshot, @created_at
    )
  `).run({
    memory_id: "mem_1",
    action: "approve",
    previous_status: "pending",
    next_status: "active",
    actor: "tester",
    note: "durable preference",
    memory_snapshot: "{}",
    created_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("healthy fixture passes and database bytes remain unchanged", () => {
  const fixture = createFixture();
  insertMemory(fixture.db);
  insertAudit(fixture.db);
  fixture.db.close();
  const before = sha256(fixture.dbPath);

  const report = runHealthCheck({
    dbPath: fixture.dbPath,
    now: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(report.healthy, true);
  assert.deepEqual(report.counts, {
    total: 1,
    active: 1,
    invalid: 0,
    pending: 0,
    skip: 0,
    pinned: 0,
    auditRows: 1,
  });
  assert.equal(report.checks.integrity.ok, true);
  assert.equal(sha256(fixture.dbPath), before);
});

test("detects unexplained pending, active duplicates, pollution, and empty fields", () => {
  const fixture = createFixture();
  insertMemory(fixture.db, {
    id: "mem_pending",
    source_key: "pending",
    status: "pending",
    title: "",
    content: "SYSTEM ACTION MODE: internal trigger, not user chat.",
    source_message_ids: "[]",
    source_file: "",
  });
  insertMemory(fixture.db, {
    id: "mem_duplicate_1",
    source_key: "duplicate-1",
    content: "Same durable fact",
  });
  insertMemory(fixture.db, {
    id: "mem_duplicate_2",
    source_key: "duplicate-2",
    content: " same   durable fact ",
  });
  fixture.db.close();

  const report = runHealthCheck({
    dbPath: fixture.dbPath,
    now: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(report.healthy, false);
  assert.equal(report.checks.pendingReasons.count, 1);
  assert.equal(report.checks.pendingPollution.count, 1);
  assert.equal(report.checks.duplicateActive.count, 1);
  assert.equal(report.checks.emptySummary.count, 1);
  assert.equal(report.checks.emptySource.count, 1);
});

test("detects pinned invalid and invalid memory recalled in the last 30 days", () => {
  const fixture = createFixture();
  insertMemory(fixture.db, {
    id: "mem_invalid",
    source_key: "invalid",
    status: "invalid",
    pinned: 1,
    last_recalled: "2026-06-10T00:00:00.000Z",
  });
  insertAudit(fixture.db, {
    memory_id: "mem_invalid",
    action: "reject",
    next_status: "invalid",
  });
  fixture.db.close();

  const report = runHealthCheck({
    dbPath: fixture.dbPath,
    now: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(report.checks.pinnedInvalid.count, 1);
  assert.equal(report.checks.recentlyRecalledInvalid.count, 1);
  assert.equal(report.healthy, false);
});

test("counts explained pending as explicit skip and writes JSON plus Markdown", () => {
  const fixture = createFixture();
  insertMemory(fixture.db, {
    id: "mem_skip",
    source_key: "skip",
    status: "pending",
  });
  insertAudit(fixture.db, {
    memory_id: "mem_skip",
    action: "skip",
    next_status: "pending",
    note: "Needs missing relationship context.",
  });
  fixture.db.close();

  const report = runHealthCheck({
    dbPath: fixture.dbPath,
    now: "2026-06-15T00:00:00.000Z",
  });
  const paths = writeReports(report, {
    outputDir: fixture.root,
    prefix: "health",
  });

  assert.equal(report.counts.pending, 1);
  assert.equal(report.counts.skip, 1);
  assert.equal(report.checks.pendingReasons.ok, true);
  assert.equal(fs.existsSync(paths.jsonPath), true);
  assert.equal(fs.existsSync(paths.markdownPath), true);
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /Overall critical health/);
});
