const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const { runMaintenance } = require("../scripts/memory-v2-maintenance");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("unified maintenance writes reports only and preserves database bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-maintenance-"));
  const dbPath = path.join(root, "memory-v2.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE memory_index (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_message_ids TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_timestamp TEXT NOT NULL,
      heat REAL NOT NULL,
      last_recalled TEXT,
      pinned INTEGER NOT NULL
    );
    CREATE TABLE memory_review_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      action TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO memory_index VALUES (
      'mem_1', 'active', 'Preference', 'The user likes tea.',
      '["source_1"]', '/root/.cyberboss/conversations/2026-01-01.jsonl',
      '2026-01-01T00:00:00.000Z', 0.1, NULL, 0
    );
    INSERT INTO memory_review_audit VALUES (
      1, 'mem_1', 'approve', 'durable preference', '2026-01-01T00:00:00.000Z'
    );
  `);
  db.close();
  const before = sha256(dbPath);

  const result = runMaintenance({
    dbPath,
    outputRoot: path.join(root, "reports"),
    now: "2026-06-15T13:00:00.000Z",
  });

  assert.equal(result.manifest.readOnly, true);
  assert.equal(result.manifest.health.healthy, true);
  assert.deepEqual(result.manifest.safety, {
    databaseWrites: 0,
    l0Writes: 0,
    pm2Restarts: 0,
  });
  assert.equal(fs.existsSync(path.join(result.runDir, "health.json")), true);
  assert.equal(fs.existsSync(path.join(result.runDir, "health.md")), true);
  assert.equal(fs.existsSync(path.join(result.runDir, "night-dry-run.json")), true);
  assert.equal(fs.existsSync(path.join(result.runDir, "night-dry-run.md")), true);
  assert.equal(fs.existsSync(result.summaryPath), true);
  assert.equal(sha256(dbPath), before);
});
