#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function migrateRecallHeat({
  dbPath,
  reportPath,
  now = new Date(),
  env = process.env,
} = {}) {
  requireBackupGate(env);
  const databasePath = requireFile(dbPath);
  const outputPath = path.resolve(String(reportPath || ""));
  if (!reportPath) {
    throw new Error("Migration report path is required");
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  if (fs.existsSync(outputPath)) {
    throw new Error(`Migration report already exists: ${outputPath}`);
  }

  const migratedAt = normalizeDate(now).toISOString();
  const shaBefore = sha256File(databasePath);
  const db = new DatabaseSync(databasePath);
  let report;
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const integrityBefore = readIntegrity(db);
    if (!integrityBefore.ok) {
      throw new Error(`Pre-migration integrity failed: ${integrityBefore.messages.join("; ")}`);
    }
    const schemaBefore = inspectSchema(db);
    assertPreMigrationSchema(schemaBefore);
    const baseline = snapshotDatabase(db);

    db.exec("BEGIN IMMEDIATE");
    try {
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

        UPDATE memory_index
        SET last_recalled_at = last_recalled
        WHERE last_recalled IS NOT NULL
          AND TRIM(last_recalled) != ''
          AND julianday(last_recalled) IS NOT NULL;
      `);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const schemaAfter = inspectSchema(db);
    const finalState = snapshotDatabase(db);
    const integrityAfter = readIntegrity(db);
    const legacyValid = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM memory_index
      WHERE last_recalled IS NOT NULL
        AND TRIM(last_recalled) != ''
        AND julianday(last_recalled) IS NOT NULL
    `).get().count);
    const legacyCopied = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM memory_index
      WHERE last_recalled_at = last_recalled
        AND last_recalled IS NOT NULL
        AND TRIM(last_recalled) != ''
        AND julianday(last_recalled) IS NOT NULL
    `).get().count);
    const nonZeroRecallCounts = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM memory_index
      WHERE recall_count != 0
    `).get().count);
    const auditRows = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM memory_recall_audit
    `).get().count);

    report = {
      schemaVersion: 1,
      migratedAt,
      database: databasePath,
      backup: {
        directory: env.MEMORY_V2_BACKUP_DIR,
        sha256: env.MEMORY_V2_BACKUP_SHA256,
        verified: env.MEMORY_V2_BACKUP_VERIFIED === "true",
      },
      databaseSha256Before: shaBefore,
      databaseSha256After: "",
      integrityBefore: integrityBefore.messages,
      integrityAfter: integrityAfter.messages,
      schemaBefore,
      schemaAfter,
      countsBefore: baseline.counts,
      countsAfter: finalState.counts,
      contentDigestBefore: baseline.contentDigest,
      contentDigestAfter: finalState.contentDigest,
      sourceDigestBefore: baseline.sourceDigest,
      sourceDigestAfter: finalState.sourceDigest,
      validLegacyRecallTimestamps: legacyValid,
      copiedLegacyRecallTimestamps: legacyCopied,
      nonZeroRecallCountDefaults: nonZeroRecallCounts,
      recallAuditRows: auditRows,
      passed: (
        integrityAfter.ok
        && schemaAfter.lastRecalledAt
        && schemaAfter.recallCount
        && schemaAfter.recallAuditTable
        && schemaAfter.recallAuditIndex
        && JSON.stringify(baseline.counts) === JSON.stringify(finalState.counts)
        && baseline.contentDigest === finalState.contentDigest
        && baseline.sourceDigest === finalState.sourceDigest
        && legacyValid === legacyCopied
        && nonZeroRecallCounts === 0
        && auditRows === 0
      ),
    };
  } finally {
    db.close();
  }

  report.databaseSha256After = sha256File(databasePath);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (!report.passed) {
    throw new Error(`Post-migration verification failed; report: ${outputPath}`);
  }
  return { reportPath: outputPath, report };
}

function requireBackupGate(env) {
  if (env.MEMORY_V2_BACKUP_VERIFIED !== "true") {
    throw new Error("Migration requires MEMORY_V2_BACKUP_VERIFIED=true");
  }
  if (!env.MEMORY_V2_BACKUP_DIR || !fs.statSync(env.MEMORY_V2_BACKUP_DIR, {
    throwIfNoEntry: false,
  })?.isDirectory()) {
    throw new Error("Migration requires an existing MEMORY_V2_BACKUP_DIR");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(env.MEMORY_V2_BACKUP_SHA256 || ""))) {
    throw new Error("Migration requires a valid MEMORY_V2_BACKUP_SHA256");
  }
}

function assertPreMigrationSchema(schema) {
  if (!schema.memoryIndex) {
    throw new Error("memory_index table is missing");
  }
  if (!schema.legacyLastRecalled || !schema.heat || !schema.pinned) {
    throw new Error("memory_index lacks required legacy recall/heat columns");
  }
  if (
    schema.lastRecalledAt
    || schema.recallCount
    || schema.recallAuditTable
    || schema.recallAuditIndex
  ) {
    throw new Error("Recall/heat schema migration is already present or partially present");
  }
}

function inspectSchema(db) {
  const tableNames = new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => row.name));
  const indexNames = new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index'
  `).all().map((row) => row.name));
  const columns = tableNames.has("memory_index")
    ? new Set(db.prepare("PRAGMA table_info(memory_index)").all().map((row) => row.name))
    : new Set();
  return {
    memoryIndex: tableNames.has("memory_index"),
    legacyLastRecalled: columns.has("last_recalled"),
    lastRecalledAt: columns.has("last_recalled_at"),
    recallCount: columns.has("recall_count"),
    heat: columns.has("heat"),
    pinned: columns.has("pinned"),
    recallAuditTable: tableNames.has("memory_recall_audit"),
    recallAuditIndex: indexNames.has("idx_memory_recall_audit_memory_time"),
  };
}

function snapshotDatabase(db) {
  const counts = Object.fromEntries(db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM memory_index
    GROUP BY status
    ORDER BY status
  `).all().map((row) => [row.status, Number(row.count)]));
  return {
    counts,
    contentDigest: digestRows(db.prepare(`
      SELECT id, content FROM memory_index ORDER BY id
    `).all()),
    sourceDigest: digestRows(db.prepare(`
      SELECT id, source_key, source_message_ids, source_file, source_timestamp
      FROM memory_index
      ORDER BY id
    `).all()),
  };
}

function readIntegrity(db) {
  const messages = db.prepare("PRAGMA integrity_check").all()
    .map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? ""));
  return { ok: messages.length === 1 && messages[0] === "ok", messages };
}

function digestRows(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function requireFile(value) {
  const resolved = path.resolve(String(value || ""));
  if (!value || !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Database does not exist: ${resolved}`);
  }
  return resolved;
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid migration time: ${value}`);
  }
  return date;
}

function parseArgs(argv) {
  const options = {};
  const mapping = {
    "--db": "dbPath",
    "--report": "reportPath",
    "--now": "now",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = mapping[argv[index]];
    const value = argv[index + 1];
    if (!key || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    }
    options[key] = value;
    index += 1;
  }
  if (!options.dbPath || !options.reportPath) {
    throw new Error(
      "Usage: node scripts/memory-v2-recall-heat-migrate.js "
      + "--db FILE --report FILE [--now ISO]",
    );
  }
  return options;
}

if (require.main === module) {
  try {
    const result = migrateRecallHeat(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({
      reportPath: result.reportPath,
      passed: result.report.passed,
      databaseSha256Before: result.report.databaseSha256Before,
      databaseSha256After: result.report.databaseSha256After,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`[memory-v2-recall-heat-migrate] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  migrateRecallHeat,
};
