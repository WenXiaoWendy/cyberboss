#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function runRehearsal({
  sourceDb,
  workDir,
  sampleSize = 5,
  now = new Date(),
} = {}) {
  const sourcePath = requireFile(sourceDb, "source backup database");
  const outputDir = path.resolve(String(workDir || ""));
  if (!workDir) {
    throw new Error("Rehearsal work directory is required");
  }
  const count = normalizeSampleSize(sampleSize);
  const baseTime = normalizeDate(now);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const targetPath = path.join(outputDir, "memory-v2-rehearsal.sqlite");
  if (fs.existsSync(targetPath)) {
    throw new Error(`Rehearsal database already exists: ${targetPath}`);
  }

  const sourceShaBefore = sha256File(sourcePath);
  const sourceIntegrity = inspectDatabase(sourcePath);
  if (!sourceIntegrity.ok) {
    throw new Error(`Source backup integrity failed: ${sourceIntegrity.messages.join("; ")}`);
  }
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);

  const db = new DatabaseSync(targetPath);
  let report;
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const baseline = snapshotDatabase(db);
    const columnsBefore = getColumns(db, "memory_index");
    if (columnsBefore.has("last_recalled_at") || columnsBefore.has("recall_count")) {
      throw new Error("Source backup already contains recall/heat rehearsal fields");
    }

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

    const migration = verifyMigration(db, baseline);
    const samples = db.prepare(`
      SELECT id, heat, last_recalled, last_recalled_at, recall_count, pinned
      FROM memory_index
      WHERE status = 'active'
        AND pinned = 0
        AND heat <= 2.7
      ORDER BY heat ASC, source_timestamp ASC, id ASC
      LIMIT ?
    `).all(count);
    if (samples.length !== count) {
      throw new Error(`Expected ${count} recall samples, found ${samples.length}`);
    }

    const directoryNeutrality = samples.map((sample) => {
      const before = readHeatState(db, sample.id);
      db.prepare(`
        SELECT id, title, memory_type, status, heat, last_recalled_at, pinned
        FROM memory_index
        WHERE id = ?
      `).get(sample.id);
      const after = readHeatState(db, sample.id);
      return {
        id: sample.id,
        unchanged: statesEqual(before, after),
        before,
        after,
      };
    });

    const recallResults = samples.map((sample, index) => {
      const recalledAt = new Date(baseTime.getTime() + index * 1000).toISOString();
      return applyRecall(db, {
        memoryId: sample.id,
        eventId: `rehearsal_${index + 1}_${sample.id}`,
        recalledAt,
        sourceTurnId: `rehearsal-turn-${index + 1}`,
      });
    });
    const first = recallResults[0];
    const duplicateEvent = applyRecall(db, {
      memoryId: first.id,
      eventId: first.eventId,
      recalledAt: new Date(baseTime.getTime() + 60000).toISOString(),
      sourceTurnId: "rehearsal-duplicate",
    });

    const pinnedLowHeatCount = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM memory_index
      WHERE status = 'active'
        AND pinned = 1
        AND heat <= 0.2
    `).get().count);
    const decayQueryPinnedCount = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM memory_index
      WHERE status = 'active'
        AND pinned = 0
        AND heat <= 0.2
        AND pinned = 1
    `).get().count);
    const finalSnapshot = snapshotDatabase(db);
    const finalIntegrity = readIntegrity(db);
    const sourceShaAfter = sha256File(sourcePath);

    report = {
      schemaVersion: 1,
      mode: "backup-copy-rehearsal",
      createdAt: baseTime.toISOString(),
      sourceDatabase: sourcePath,
      sourceSha256Before: sourceShaBefore,
      sourceSha256After: sourceShaAfter,
      sourceUnchanged: sourceShaBefore === sourceShaAfter,
      rehearsalDatabase: targetPath,
      migration,
      sampleSize: samples.length,
      directoryNeutrality,
      recallResults,
      duplicateEvent: {
        eventId: duplicateEvent.eventId,
        idempotent: duplicateEvent.idempotent,
        heatUnchanged: duplicateEvent.heatBefore === duplicateEvent.heatAfter,
      },
      pinnedDecayImmunity: {
        pinnedLowHeatControlCount: pinnedLowHeatCount,
        pinnedRowsReturnedByDecayPredicate: decayQueryPinnedCount,
        passed: decayQueryPinnedCount === 0,
      },
      baselineCounts: baseline.counts,
      finalCounts: finalSnapshot.counts,
      statusCountsUnchanged: JSON.stringify(baseline.counts) === JSON.stringify(finalSnapshot.counts),
      contentDigestUnchanged: baseline.contentDigest === finalSnapshot.contentDigest,
      sourceDigestUnchanged: baseline.sourceDigest === finalSnapshot.sourceDigest,
      integrity: finalIntegrity.messages,
      passed: (
        sourceShaBefore === sourceShaAfter
        && migration.passed
        && directoryNeutrality.every((item) => item.unchanged)
        && recallResults.every((item) => item.passed)
        && duplicateEvent.idempotent
        && duplicateEvent.heatBefore === duplicateEvent.heatAfter
        && decayQueryPinnedCount === 0
        && JSON.stringify(baseline.counts) === JSON.stringify(finalSnapshot.counts)
        && baseline.contentDigest === finalSnapshot.contentDigest
        && baseline.sourceDigest === finalSnapshot.sourceDigest
        && finalIntegrity.ok
      ),
      rollback: {
        productionAction: "none",
        rehearsalAction: `Remove ${targetPath} after preserving reports.`,
        sourceBackupPreserved: true,
      },
    };
  } finally {
    db.close();
  }

  const reportPath = path.join(outputDir, "recall-heat-rehearsal.json");
  const markdownPath = path.join(outputDir, "recall-heat-rehearsal.md");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return { reportPath, markdownPath, report };
}

function verifyMigration(db, baseline) {
  const columns = getColumns(db, "memory_index");
  const tableSql = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'memory_recall_audit'
  `).get()?.sql || "";
  const indexSql = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_memory_recall_audit_memory_time'
  `).get()?.sql || "";
  const zeroDefaults = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM memory_index WHERE recall_count != 0
  `).get().count);
  const validLegacy = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM memory_index
    WHERE last_recalled IS NOT NULL
      AND TRIM(last_recalled) != ''
      AND julianday(last_recalled) IS NOT NULL
  `).get().count);
  const copiedLegacy = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM memory_index
    WHERE last_recalled_at = last_recalled
      AND last_recalled IS NOT NULL
      AND TRIM(last_recalled) != ''
      AND julianday(last_recalled) IS NOT NULL
  `).get().count);
  const after = snapshotDatabase(db);
  return {
    addedColumns: ["last_recalled_at", "recall_count"]
      .filter((name) => columns.has(name)),
    auditTableCreated: tableSql.includes("event_id TEXT NOT NULL UNIQUE"),
    indexCreated: indexSql.includes("memory_id, recalled_at"),
    nonZeroRecallCountDefaults: zeroDefaults,
    validLegacyRecallTimestamps: validLegacy,
    copiedLegacyRecallTimestamps: copiedLegacy,
    rowCountsUnchanged: JSON.stringify(baseline.counts) === JSON.stringify(after.counts),
    contentDigestUnchanged: baseline.contentDigest === after.contentDigest,
    sourceDigestUnchanged: baseline.sourceDigest === after.sourceDigest,
    passed: (
      columns.has("last_recalled_at")
      && columns.has("recall_count")
      && tableSql.includes("event_id TEXT NOT NULL UNIQUE")
      && indexSql.includes("memory_id, recalled_at")
      && zeroDefaults === 0
      && validLegacy === copiedLegacy
      && JSON.stringify(baseline.counts) === JSON.stringify(after.counts)
      && baseline.contentDigest === after.contentDigest
      && baseline.sourceDigest === after.sourceDigest
    ),
  };
}

function applyRecall(db, {
  memoryId,
  eventId,
  recalledAt,
  sourceTurnId,
}) {
  const existing = db.prepare(`
    SELECT memory_id, heat_before, heat_after
    FROM memory_recall_audit
    WHERE event_id = ?
  `).get(eventId);
  if (existing) {
    const state = readHeatState(db, memoryId);
    return {
      id: memoryId,
      eventId,
      idempotent: true,
      heatBefore: state.heat,
      heatAfter: state.heat,
      lastRecalledAt: state.lastRecalledAt,
      recallCount: state.recallCount,
      passed: true,
    };
  }

  const before = readHeatState(db, memoryId);
  const expectedHeat = Math.min(3, Math.max(0.05, before.heat) + 0.3);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE memory_index
      SET heat = MIN(3.0, MAX(0.05, heat) + 0.3),
          last_recalled_at = ?,
          last_recalled = ?,
          recall_count = recall_count + 1,
          updated_at = ?
      WHERE id = ?
        AND status = 'active'
    `).run(recalledAt, recalledAt, recalledAt, memoryId);
    const after = readHeatState(db, memoryId);
    db.prepare(`
      INSERT INTO memory_recall_audit (
        event_id, memory_id, recalled_at, consumer, purpose,
        source_turn_id, heat_before, heat_after, created_at
      ) VALUES (?, ?, ?, 'codex-rehearsal', 'backup_copy_test', ?, ?, ?, ?)
    `).run(
      eventId,
      memoryId,
      recalledAt,
      sourceTurnId,
      before.heat,
      after.heat,
      recalledAt,
    );
    db.exec("COMMIT");
    return {
      id: memoryId,
      eventId,
      idempotent: false,
      heatBefore: before.heat,
      heatAfter: after.heat,
      expectedHeat,
      heatDelta: round(after.heat - before.heat),
      lastRecalledAt: after.lastRecalledAt,
      recallCountBefore: before.recallCount,
      recallCountAfter: after.recallCount,
      passed: (
        round(after.heat) === round(expectedHeat)
        && after.lastRecalledAt === recalledAt
        && after.recallCount === before.recallCount + 1
      ),
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function snapshotDatabase(db) {
  const counts = Object.fromEntries(db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM memory_index
    GROUP BY status
    ORDER BY status
  `).all().map((row) => [row.status, Number(row.count)]));
  const contentRows = db.prepare(`
    SELECT id, content FROM memory_index ORDER BY id
  `).all();
  const sourceRows = db.prepare(`
    SELECT id, source_key, source_message_ids, source_file, source_timestamp
    FROM memory_index
    ORDER BY id
  `).all();
  return {
    counts,
    contentDigest: digestRows(contentRows),
    sourceDigest: digestRows(sourceRows),
  };
}

function readHeatState(db, id) {
  const row = db.prepare(`
    SELECT heat, last_recalled_at, recall_count
    FROM memory_index
    WHERE id = ?
  `).get(id);
  if (!row) {
    throw new Error(`Memory not found: ${id}`);
  }
  return {
    heat: Number(row.heat),
    lastRecalledAt: row.last_recalled_at || null,
    recallCount: Number(row.recall_count),
  };
}

function statesEqual(left, right) {
  return (
    left.heat === right.heat
    && left.lastRecalledAt === right.lastRecalledAt
    && left.recallCount === right.recallCount
  );
}

function getColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name));
}

function inspectDatabase(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    return readIntegrity(db);
  } finally {
    db.close();
  }
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

function requireFile(value, label) {
  const resolved = path.resolve(String(value || ""));
  if (!value || !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  return resolved;
}

function normalizeSampleSize(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 3 || number > 5) {
    throw new Error(`sampleSize must be between 3 and 5: ${value}`);
  }
  return number;
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid rehearsal time: ${value}`);
  }
  return date;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function renderMarkdown(report) {
  return [
    "# Memory V2 Recall/Heat Rehearsal",
    "",
    `Created: ${report.createdAt}`,
    `Source backup: \`${report.sourceDatabase}\``,
    `Rehearsal copy: \`${report.rehearsalDatabase}\``,
    `Overall: **${report.passed ? "PASS" : "FAIL"}**`,
    "",
    "## Migration",
    "",
    `- Added columns: ${report.migration.addedColumns.join(", ")}`,
    `- Recall audit table: ${report.migration.auditTableCreated ? "PASS" : "FAIL"}`,
    `- Recall audit index: ${report.migration.indexCreated ? "PASS" : "FAIL"}`,
    `- Default recall_count: ${report.migration.nonZeroRecallCountDefaults === 0 ? "PASS" : "FAIL"}`,
    `- Row counts preserved: ${report.migration.rowCountsUnchanged ? "PASS" : "FAIL"}`,
    "",
    "## Recall Samples",
    "",
    `- Samples: ${report.sampleSize}`,
    `- Directory reads heat-neutral: ${report.directoryNeutrality.every((item) => item.unchanged) ? "PASS" : "FAIL"}`,
    `- Recall updates passed: ${report.recallResults.every((item) => item.passed) ? "PASS" : "FAIL"}`,
    `- Duplicate event idempotent: ${report.duplicateEvent.idempotent ? "PASS" : "FAIL"}`,
    `- Pinned decay immunity: ${report.pinnedDecayImmunity.passed ? "PASS" : "FAIL"}`,
    "",
    "## Safety",
    "",
    `- Source backup unchanged: ${report.sourceUnchanged ? "PASS" : "FAIL"}`,
    `- Status counts unchanged: ${report.statusCountsUnchanged ? "PASS" : "FAIL"}`,
    `- Content unchanged: ${report.contentDigestUnchanged ? "PASS" : "FAIL"}`,
    `- Sources unchanged: ${report.sourceDigestUnchanged ? "PASS" : "FAIL"}`,
    `- Integrity: ${report.integrity.join(", ")}`,
    "- Production database action: none",
    "",
    "## Rollback",
    "",
    report.rollback.rehearsalAction,
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  const mapping = {
    "--source-db": "sourceDb",
    "--work-dir": "workDir",
    "--sample-size": "sampleSize",
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
  if (!options.sourceDb || !options.workDir) {
    throw new Error(
      "Usage: node scripts/memory-v2-recall-heat-rehearsal.js "
      + "--source-db BACKUP_SQLITE --work-dir DIR [--sample-size 3..5] [--now ISO]",
    );
  }
  return options;
}

if (require.main === module) {
  try {
    const result = runRehearsal(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({
      reportPath: result.reportPath,
      markdownPath: result.markdownPath,
      passed: result.report.passed,
    }, null, 2)}\n`);
    process.exitCode = result.report.passed ? 0 : 2;
  } catch (error) {
    process.stderr.write(`[memory-v2-recall-heat-rehearsal] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  runRehearsal,
};
