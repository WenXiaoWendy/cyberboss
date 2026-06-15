const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const {
  runRehearsal,
} = require("../scripts/memory-v2-recall-heat-rehearsal");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("migrates only a backup copy and verifies five recall samples", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-recall-rehearsal-"));
  const sourceDb = path.join(root, "backup.sqlite");
  const workDir = path.join(root, "work");
  const db = new DatabaseSync(sourceDb);
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
  const insert = db.prepare(`
    INSERT INTO memory_index VALUES (
      ?, ?, ?, 'conversation', ?, ?, ?, ?, ?, 'user',
      ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    )
  `);
  for (let index = 1; index <= 7; index += 1) {
    insert.run(
      `mem_${index}`,
      `source_${index}`,
      "active",
      `Memory ${index}`,
      `Content ${index}`,
      JSON.stringify([`message_${index}`]),
      `/l0/${index}.jsonl`,
      `2026-01-0${index}T00:00:00.000Z`,
      index === 7 ? 2.9 : index === 6 ? 0.1 : 0.1 * index,
      index === 1 ? "2026-02-01T00:00:00.000Z" : null,
      index === 6 ? 1 : 0,
    );
  }
  db.close();
  const before = sha256(sourceDb);

  const result = runRehearsal({
    sourceDb,
    workDir,
    sampleSize: 5,
    now: "2026-06-15T08:00:00.000Z",
  });

  assert.equal(result.report.passed, true);
  assert.equal(result.report.sampleSize, 5);
  assert.equal(result.report.migration.passed, true);
  assert.equal(result.report.recallResults.every((item) => item.heatDelta === 0.3), true);
  assert.equal(result.report.directoryNeutrality.every((item) => item.unchanged), true);
  assert.equal(result.report.duplicateEvent.idempotent, true);
  assert.equal(result.report.pinnedDecayImmunity.passed, true);
  assert.equal(result.report.pinnedDecayImmunity.pinnedLowHeatControlCount, 1);
  assert.equal(result.report.statusCountsUnchanged, true);
  assert.equal(result.report.contentDigestUnchanged, true);
  assert.equal(result.report.sourceDigestUnchanged, true);
  assert.equal(sha256(sourceDb), before);
  assert.equal(fs.existsSync(result.reportPath), true);
  assert.equal(fs.existsSync(result.markdownPath), true);
});
