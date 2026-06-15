const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const {
  migrateRecallHeat,
} = require("../scripts/memory-v2-recall-heat-migrate");

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-recall-migrate-"));
  const dbPath = path.join(root, "memory-v2.sqlite");
  const backupDir = path.join(root, "backup");
  const reportPath = path.join(root, "reports", "migration.json");
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
    INSERT INTO memory_index VALUES (
      'mem_1', 'source_1', 'active', 'conversation', 'Memory', 'Content',
      '["message_1"]', '/l0/1.jsonl', '2026-01-01T00:00:00.000Z',
      'user', 0.05, '2026-02-01T00:00:00.000Z', 0,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `);
  db.close();
  return { root, dbPath, backupDir, reportPath };
}

function gateEnv(fixture) {
  return {
    MEMORY_V2_BACKUP_VERIFIED: "true",
    MEMORY_V2_BACKUP_DIR: fixture.backupDir,
    MEMORY_V2_BACKUP_SHA256: "a".repeat(64),
  };
}

test("refuses migration without the verified backup gate", () => {
  const fixture = createFixture();
  assert.throws(
    () => migrateRecallHeat({
      dbPath: fixture.dbPath,
      reportPath: fixture.reportPath,
      env: {},
    }),
    /MEMORY_V2_BACKUP_VERIFIED/,
  );
});

test("performs only the rehearsed additive migration", () => {
  const fixture = createFixture();
  const result = migrateRecallHeat({
    dbPath: fixture.dbPath,
    reportPath: fixture.reportPath,
    now: "2026-06-15T09:00:00.000Z",
    env: gateEnv(fixture),
  });

  assert.equal(result.report.passed, true);
  assert.deepEqual(result.report.countsBefore, { active: 1 });
  assert.deepEqual(result.report.countsAfter, { active: 1 });
  assert.equal(result.report.validLegacyRecallTimestamps, 1);
  assert.equal(result.report.copiedLegacyRecallTimestamps, 1);
  assert.equal(result.report.nonZeroRecallCountDefaults, 0);
  assert.equal(result.report.recallAuditRows, 0);

  const db = new DatabaseSync(fixture.dbPath, { readOnly: true });
  const columns = new Set(db.prepare("PRAGMA table_info(memory_index)").all()
    .map((row) => row.name));
  assert.equal(columns.has("last_recalled_at"), true);
  assert.equal(columns.has("recall_count"), true);
  assert.equal(db.prepare(`
    SELECT last_recalled_at, recall_count FROM memory_index WHERE id = 'mem_1'
  `).get().last_recalled_at, "2026-02-01T00:00:00.000Z");
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM memory_recall_audit
  `).get().count, 0);
  db.close();
});

test("refuses a repeated or partial migration", () => {
  const fixture = createFixture();
  migrateRecallHeat({
    dbPath: fixture.dbPath,
    reportPath: fixture.reportPath,
    env: gateEnv(fixture),
  });
  assert.throws(
    () => migrateRecallHeat({
      dbPath: fixture.dbPath,
      reportPath: path.join(fixture.root, "second.json"),
      env: gateEnv(fixture),
    }),
    /already present or partially present/,
  );
});
