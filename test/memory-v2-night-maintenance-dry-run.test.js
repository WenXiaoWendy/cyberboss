const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const {
  runNightMaintenanceDryRun,
  writeReports,
} = require("../scripts/memory-v2-night-maintenance-dry-run");

function createFixture({ structuredFacts = false, graph = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-night-dry-run-"));
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
      ${structuredFacts ? ", fact_key TEXT, fact_value TEXT" : ""}
    );
  `);
  if (graph) {
    db.exec(`
      CREATE TABLE memory_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL
      );
    `);
  }
  return { root, dbPath, db };
}

function insertMemory(db, row = {}) {
  const columns = new Set(db.prepare("PRAGMA table_info(memory_index)").all()
    .map((item) => item.name));
  const value = {
    id: "mem_1",
    status: "active",
    title: "Memory",
    content: "Durable preference",
    source_message_ids: '["source_1"]',
    source_file: "/root/.cyberboss/conversations/2026-01-01.jsonl",
    source_timestamp: "2026-01-01T00:00:00.000Z",
    heat: 0.1,
    last_recalled: null,
    pinned: 0,
    fact_key: null,
    fact_value: null,
    ...row,
  };
  const names = Object.keys(value).filter((name) => columns.has(name));
  const bindings = Object.fromEntries(names.map((name) => [name, value[name]]));
  db.prepare(`
    INSERT INTO memory_index (${names.join(", ")})
    VALUES (${names.map((name) => `@${name}`).join(", ")})
  `).run(bindings);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("proposes softening only for old low-heat unpinned active L1 memories", () => {
  const fixture = createFixture();
  insertMemory(fixture.db, { id: "old-low", heat: 0.1 });
  insertMemory(fixture.db, { id: "pinned", heat: 0.1, pinned: 1 });
  insertMemory(fixture.db, {
    id: "recent",
    heat: 0.1,
    last_recalled: "2026-06-10T00:00:00.000Z",
  });
  insertMemory(fixture.db, { id: "hot", heat: 1.2 });
  insertMemory(fixture.db, { id: "invalid", status: "invalid", heat: 0.05 });
  fixture.db.close();

  const report = runNightMaintenanceDryRun({
    dbPath: fixture.dbPath,
    now: "2026-06-15T00:00:00.000Z",
  });
  assert.equal(report.proposals.softening.count, 1);
  assert.equal(report.proposals.softening.candidates[0].id, "old-low");
  assert.equal(report.proposals.softening.candidates[0].proposedHeat, 0.085);
});

test("finds exact active duplicates and emits bounded insights with source_ids", () => {
  const fixture = createFixture();
  insertMemory(fixture.db, {
    id: "duplicate-a",
    content: "The user likes quiet mornings.",
    source_message_ids: '["source_a"]',
    heat: 0.2,
  });
  insertMemory(fixture.db, {
    id: "duplicate-b",
    content: "  the user likes QUIET mornings. ",
    source_message_ids: '["source_b"]',
    heat: 0.8,
  });
  fixture.db.close();

  const report = runNightMaintenanceDryRun({
    dbPath: fixture.dbPath,
    now: "2026-06-15T00:00:00.000Z",
    maxInsights: 1,
  });
  assert.equal(report.proposals.duplicateMemories.count, 1);
  assert.equal(report.proposals.duplicateMemories.groups[0].survivorId, "duplicate-b");
  assert.equal(report.proposals.insights.count, 1);
  assert.deepEqual(
    report.proposals.insights.items[0].source_ids.sort(),
    ["source_a", "source_b"],
  );
  assert.equal(report.proposals.insights.items[0].proposedStatus, "pending");
});

test("reports stale graph edges and structured fact conflicts when schema supports them", () => {
  const fixture = createFixture({ structuredFacts: true, graph: true });
  insertMemory(fixture.db, {
    id: "city-old",
    fact_key: "profile.city",
    fact_value: "Hefei",
  });
  insertMemory(fixture.db, {
    id: "city-new",
    fact_key: "profile.city",
    fact_value: "Dali",
    source_timestamp: "2026-06-01T00:00:00.000Z",
  });
  insertMemory(fixture.db, { id: "inactive", status: "invalid" });
  fixture.db.prepare("INSERT INTO memory_edges VALUES (?, ?, ?)").run(
    "edge-stale",
    "city-new",
    "inactive",
  );
  fixture.db.close();

  const report = runNightMaintenanceDryRun({
    dbPath: fixture.dbPath,
    now: "2026-06-15T00:00:00.000Z",
  });
  assert.equal(report.proposals.staleGraphEdges.supported, true);
  assert.equal(report.proposals.staleGraphEdges.count, 1);
  assert.equal(report.proposals.factConflicts.supported, true);
  assert.equal(report.proposals.factConflicts.count, 1);
});

test("marks unsupported schema analyses honestly and never changes database bytes", () => {
  const fixture = createFixture();
  insertMemory(fixture.db);
  fixture.db.close();
  const before = sha256(fixture.dbPath);

  const report = runNightMaintenanceDryRun({
    dbPath: fixture.dbPath,
    now: "2026-06-15T00:00:00.000Z",
  });
  const reports = writeReports(report, {
    outputDir: fixture.root,
    prefix: "night",
  });

  assert.equal(report.proposals.staleGraphEdges.supported, false);
  assert.equal(report.proposals.factConflicts.supported, false);
  assert.deepEqual(report.safety, {
    databaseWrites: 0,
    l0Writes: 0,
    statusChanges: 0,
    edgeDeletes: 0,
    insightInserts: 0,
    requiresBackupToApply: true,
    requiresExplicitApprovalToApply: true,
  });
  assert.equal(sha256(fixture.dbPath), before);
  assert.equal(fs.existsSync(reports.jsonPath), true);
  assert.equal(fs.existsSync(reports.markdownPath), true);
});
