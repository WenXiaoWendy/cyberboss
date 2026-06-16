#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULTS = {
  softenHeatAtOrBelow: 0.2,
  softenAgeDays: 90,
  maxInsights: 5,
  sampleLimit: 20,
};

function runNightMaintenanceDryRun({
  dbPath,
  now = new Date(),
  softenHeatAtOrBelow = DEFAULTS.softenHeatAtOrBelow,
  softenAgeDays = DEFAULTS.softenAgeDays,
  maxInsights = DEFAULTS.maxInsights,
  sampleLimit = DEFAULTS.sampleLimit,
} = {}) {
  const resolvedDbPath = requireDatabase(dbPath);
  const checkedAt = normalizeDate(now);
  const cutoff = new Date(
    checkedAt.getTime() - normalizePositiveNumber(softenAgeDays, "softenAgeDays") * 86400000,
  );
  const db = new DatabaseSync(resolvedDbPath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    const integrity = readIntegrity(db);
    if (!integrity.ok) {
      throw new Error(`Database integrity failed: ${integrity.messages.join("; ")}`);
    }
    const tables = getTableNames(db);
    if (!tables.has("memory_index")) {
      throw new Error("memory_index table is missing");
    }
    const columns = getColumns(db, "memory_index");
    const rows = db.prepare("SELECT * FROM memory_index ORDER BY id").all();
    const active = rows.filter((row) => row.status === "active");
    const byId = new Map(rows.map((row) => [row.id, row]));

    const softening = buildSofteningCandidates(active, {
      cutoff,
      heatThreshold: normalizeHeat(softenHeatAtOrBelow),
      sampleLimit,
    });
    const duplicateAnalysis = buildDuplicateCandidates(active, sampleLimit);
    const graphAnalysis = inspectGraphEdges(db, tables, byId, sampleLimit);
    const conflictAnalysis = inspectFactConflicts(active, columns, sampleLimit);
    const insights = buildInsightCandidates({
      duplicateGroups: duplicateAnalysis.groups,
      activeRows: active,
      columns,
      maxInsights: normalizeNonNegativeInteger(maxInsights, "maxInsights"),
    });

    return {
      schemaVersion: 1,
      mode: "dry-run",
      checkedAt: checkedAt.toISOString(),
      database: resolvedDbPath,
      readOnly: true,
      integrity: integrity.messages,
      policy: {
        softenHeatAtOrBelow: normalizeHeat(softenHeatAtOrBelow),
        softenAgeDays: Number(softenAgeDays),
        softenCutoff: cutoff.toISOString(),
        maxInsights: Number(maxInsights),
      },
      counts: {
        total: rows.length,
        active: active.length,
        invalid: rows.filter((row) => row.status === "invalid").length,
        pending: rows.filter((row) => row.status === "pending").length,
      },
      proposals: {
        softening,
        staleGraphEdges: graphAnalysis,
        duplicateMemories: {
          supported: true,
          count: duplicateAnalysis.groups.length,
          groups: sample(duplicateAnalysis.groups, sampleLimit),
        },
        factConflicts: conflictAnalysis,
        insights: {
          supported: true,
          count: insights.length,
          max: Number(maxInsights),
          items: insights,
        },
      },
      safety: {
        databaseWrites: 0,
        l0Writes: 0,
        statusChanges: 0,
        edgeDeletes: 0,
        insightInserts: 0,
        requiresBackupToApply: true,
        requiresExplicitApprovalToApply: true,
      },
    };
  } finally {
    db.close();
  }
}

function buildSofteningCandidates(rows, { cutoff, heatThreshold, sampleLimit }) {
  const candidates = [];
  for (const row of rows) {
    const heat = Number(row.heat);
    const activityAt = latestValidDate(row.last_recalled_at, row.last_recalled, row.source_timestamp);
    if (
      Boolean(row.pinned)
      || !Number.isFinite(heat)
      || heat > heatThreshold
      || !activityAt
      || activityAt.getTime() > cutoff.getTime()
    ) {
      continue;
    }
    candidates.push({
      id: row.id,
      heat,
      pinned: false,
      activityAt: activityAt.toISOString(),
      sourceTimestamp: row.source_timestamp || null,
      proposedAction: "soften_l1",
      proposedHeat: Math.max(0.05, roundHeat(heat * 0.85)),
      reason: `Unpinned active L1 memory at or below heat ${heatThreshold} with no activity after ${cutoff.toISOString()}.`,
      preview: truncate(row.content ?? row.summary, 180),
    });
  }
  candidates.sort((left, right) => (
    left.heat - right.heat
    || left.activityAt.localeCompare(right.activityAt)
    || left.id.localeCompare(right.id)
  ));
  return {
    supported: true,
    count: candidates.length,
    candidates: sample(candidates, sampleLimit),
  };
}

function buildDuplicateCandidates(rows, sampleLimit) {
  const groups = new Map();
  for (const row of rows) {
    const normalized = normalizeText(row.content ?? row.summary);
    if (!normalized) {
      continue;
    }
    const group = groups.get(normalized) || [];
    group.push(row);
    groups.set(normalized, group);
  }
  const duplicates = [];
  for (const [normalized, members] of groups.entries()) {
    if (members.length < 2) {
      continue;
    }
    const ranked = members.slice().sort(compareSurvivor);
    const survivor = ranked[0];
    duplicates.push({
      fingerprint: sha256(normalized),
      count: members.length,
      survivorId: survivor.id,
      mergeIds: ranked.slice(1).map((row) => row.id),
      sourceIds: unique(ranked.flatMap(readSourceIds)),
      proposedAction: "merge_review",
      reason: "Active memories have identical normalized content; retain the strongest provenance row after human review.",
      preview: truncate(survivor.content ?? survivor.summary, 180),
    });
  }
  duplicates.sort((left, right) => (
    right.count - left.count || left.survivorId.localeCompare(right.survivorId)
  ));
  return { count: duplicates.length, groups: sample(duplicates, sampleLimit) };
}

function inspectGraphEdges(db, tables, byId, sampleLimit) {
  const table = ["memory_edges", "memory_graph_edges"].find((name) => tables.has(name));
  if (!table) {
    return {
      supported: false,
      count: 0,
      reason: "No supported graph-edge table exists in the current schema.",
      edges: [],
    };
  }
  const columns = getColumns(db, table);
  const sourceColumn = firstColumn(columns, ["source_id", "from_id", "source_memory_id"]);
  const targetColumn = firstColumn(columns, ["target_id", "to_id", "target_memory_id"]);
  if (!sourceColumn || !targetColumn) {
    return {
      supported: false,
      count: 0,
      reason: `${table} lacks supported source and target columns.`,
      edges: [],
    };
  }
  const idColumn = firstColumn(columns, ["id", "edge_id"]);
  const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
  const stale = [];
  for (const row of rows) {
    const source = byId.get(row[sourceColumn]);
    const target = byId.get(row[targetColumn]);
    if (source?.status === "active" && target?.status === "active") {
      continue;
    }
    stale.push({
      edgeId: idColumn ? row[idColumn] : null,
      sourceId: row[sourceColumn],
      targetId: row[targetColumn],
      sourceStatus: source?.status || "missing",
      targetStatus: target?.status || "missing",
      proposedAction: "remove_stale_edge",
      reason: "At least one endpoint is missing or not active.",
    });
  }
  return {
    supported: true,
    table,
    count: stale.length,
    edges: sample(stale, sampleLimit),
  };
}

function inspectFactConflicts(rows, columns, sampleLimit) {
  const keyColumn = firstColumn(columns, ["fact_key", "canonical_key"]);
  const valueColumn = firstColumn(columns, ["fact_value", "canonical_value"]);
  if (!keyColumn || !valueColumn) {
    return {
      supported: false,
      count: 0,
      reason: "Current schema has no structured fact key/value fields; free text is not auto-labeled as a conflict.",
      conflicts: [],
    };
  }
  const byKey = new Map();
  for (const row of rows) {
    const key = normalizeText(row[keyColumn]);
    const value = normalizeText(row[valueColumn]);
    if (!key || !value) {
      continue;
    }
    const group = byKey.get(key) || [];
    group.push({ row, value });
    byKey.set(key, group);
  }
  const conflicts = [];
  for (const [key, group] of byKey.entries()) {
    const values = new Map();
    for (const item of group) {
      const list = values.get(item.value) || [];
      list.push(item.row);
      values.set(item.value, list);
    }
    if (values.size < 2) {
      continue;
    }
    conflicts.push({
      factKey: key,
      values: Array.from(values.entries()).map(([value, members]) => ({
        value,
        memoryIds: members.map((row) => row.id),
        sourceIds: unique(members.flatMap(readSourceIds)),
        newestSourceTimestamp: newestTimestamp(members),
      })),
      proposedAction: "conflict_review",
      reason: "The same structured fact key has multiple active normalized values.",
    });
  }
  conflicts.sort((left, right) => left.factKey.localeCompare(right.factKey));
  return {
    supported: true,
    count: conflicts.length,
    conflicts: sample(conflicts, sampleLimit),
  };
}

function buildInsightCandidates({
  duplicateGroups,
  activeRows,
  columns,
  maxInsights,
}) {
  if (maxInsights === 0) {
    return [];
  }
  const byId = new Map(activeRows.map((row) => [row.id, row]));
  const results = [];
  for (const group of duplicateGroups) {
    const survivor = byId.get(group.survivorId);
    if (!survivor || group.sourceIds.length === 0) {
      continue;
    }
    results.push({
      proposalId: `insight_${group.fingerprint.slice(0, 24)}`,
      memoryType: "insight",
      title: `Consolidated memory from ${group.count} matching records`,
      content: String(survivor.content ?? survivor.summary ?? "").trim(),
      source_ids: group.sourceIds,
      source_memory_ids: [group.survivorId, ...group.mergeIds],
      proposedHeat: 0.1,
      proposedStatus: "pending",
      reason: "Repeated identical active memories can be represented by one provenance-preserving insight candidate.",
    });
    if (results.length >= maxInsights) {
      break;
    }
  }

  if (results.length < maxInsights) {
    const keyColumn = firstColumn(columns, ["fact_key", "canonical_key"]);
    const valueColumn = firstColumn(columns, ["fact_value", "canonical_value"]);
    if (keyColumn && valueColumn) {
      const facts = new Map();
      for (const row of activeRows) {
        const key = normalizeText(row[keyColumn]);
        const value = normalizeText(row[valueColumn]);
        const sourceIds = readSourceIds(row);
        if (!key || !value || sourceIds.length === 0) {
          continue;
        }
        const composite = `${key}\u0000${value}`;
        const item = facts.get(composite) || { key, value, rows: [], sourceIds: [] };
        item.rows.push(row);
        item.sourceIds.push(...sourceIds);
        facts.set(composite, item);
      }
      for (const item of facts.values()) {
        const sourceIds = unique(item.sourceIds);
        if (item.rows.length < 2 || sourceIds.length < 2) {
          continue;
        }
        const fingerprint = sha256(`${item.key}\u0000${item.value}`);
        if (results.some((entry) => entry.proposalId === `insight_${fingerprint.slice(0, 24)}`)) {
          continue;
        }
        results.push({
          proposalId: `insight_${fingerprint.slice(0, 24)}`,
          memoryType: "insight",
          title: `Stable fact: ${truncate(item.key, 80)}`,
          content: item.value,
          source_ids: sourceIds,
          source_memory_ids: item.rows.map((row) => row.id),
          proposedHeat: 0.1,
          proposedStatus: "pending",
          reason: "Multiple active source memories independently support the same structured fact.",
        });
        if (results.length >= maxInsights) {
          break;
        }
      }
    }
  }
  return results;
}

function writeReports(report, { outputDir, prefix } = {}) {
  const directory = path.resolve(outputDir || path.join(process.cwd(), "tmp", "memory-night-reports"));
  fs.mkdirSync(directory, { recursive: true });
  const defaultPrefix = `memory-night-dry-run-${formatTimestamp(report.checkedAt)}`;
  const safePrefix = String(prefix || defaultPrefix).replace(/[^a-zA-Z0-9._-]/g, "_");
  const jsonPath = path.join(directory, `${safePrefix}.json`);
  const markdownPath = path.join(directory, `${safePrefix}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

function renderMarkdown(report) {
  const proposals = report.proposals;
  const lines = [
    "# Memory V2 Night Maintenance Dry Run",
    "",
    `Checked: ${report.checkedAt}`,
    `Database: \`${report.database}\``,
    "Mode: **dry-run, read-only**",
    "",
    "## Proposal Counts",
    "",
    "| Area | Supported | Candidates |",
    "| --- | --- | ---: |",
    `| softening | yes | ${proposals.softening.count} |`,
    `| stale graph edges | ${yesNo(proposals.staleGraphEdges.supported)} | ${proposals.staleGraphEdges.count} |`,
    `| duplicate memories | yes | ${proposals.duplicateMemories.count} |`,
    `| fact conflicts | ${yesNo(proposals.factConflicts.supported)} | ${proposals.factConflicts.count} |`,
    `| insight candidates | yes | ${proposals.insights.count} |`,
    "",
    "## Safety",
    "",
    `- Database writes: ${report.safety.databaseWrites}`,
    `- L0 writes: ${report.safety.l0Writes}`,
    `- Status changes: ${report.safety.statusChanges}`,
    `- Edge deletions: ${report.safety.edgeDeletes}`,
    `- Insight inserts: ${report.safety.insightInserts}`,
    "",
  ];
  for (const [name, value] of Object.entries(proposals)) {
    lines.push(`## ${name}`, "", "```json", JSON.stringify(value, null, 2), "```", "");
  }
  return `${lines.join("\n")}\n`;
}

function compareSurvivor(left, right) {
  return Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    || Number(right.heat || 0) - Number(left.heat || 0)
    || timestampValue(right.last_recalled_at || right.last_recalled || right.source_timestamp)
      - timestampValue(left.last_recalled_at || left.last_recalled || left.source_timestamp)
    || String(left.id).localeCompare(String(right.id));
}

function readSourceIds(row) {
  for (const name of ["source_ids", "source_message_ids"]) {
    const value = row[name];
    if (Array.isArray(value)) {
      return value.map(String).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map(String).filter(Boolean);
        }
      } catch {
        return [value.trim()];
      }
    }
  }
  return [];
}

function newestTimestamp(rows) {
  const values = rows.map((row) => row.source_timestamp)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  return values.at(-1) || null;
}

function latestValidDate(...values) {
  for (const value of values) {
    if (value && Number.isFinite(Date.parse(value))) {
      return new Date(value);
    }
  }
  return null;
}

function getTableNames(db) {
  return new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => row.name));
}

function getColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
    .map((row) => row.name));
}

function firstColumn(columns, candidates) {
  return candidates.find((name) => columns.has(name)) || null;
}

function readIntegrity(db) {
  const messages = db.prepare("PRAGMA integrity_check").all()
    .map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? ""));
  return { ok: messages.length === 1 && messages[0] === "ok", messages };
}

function quoteIdentifier(value) {
  const text = String(value);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) {
    throw new Error(`Unsafe SQL identifier: ${text}`);
  }
  return `"${text}"`;
}

function requireDatabase(value) {
  const resolved = path.resolve(String(value || ""));
  if (!value || !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Memory V2 database does not exist: ${resolved}`);
  }
  return resolved;
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeHeat(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0.05 || number > 3) {
    throw new Error(`Heat threshold must be within 0.05..3.0: ${value}`);
  }
  return number;
}

function normalizePositiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} must be positive: ${value}`);
  }
  return number;
}

function normalizeNonNegativeInteger(value, name) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error(`${name} must be between 0 and 100: ${value}`);
  }
  return number;
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

function roundHeat(value) {
  return Math.round(value * 1000) / 1000;
}

function timestampValue(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncate(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function unique(values) {
  return Array.from(new Set(values.map(String).filter(Boolean)));
}

function sample(values, limit) {
  return values.slice(0, Math.max(1, Number(limit) || DEFAULTS.sampleLimit));
}

function formatTimestamp(value) {
  return normalizeDate(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    const map = {
      "--db": "dbPath",
      "--output-dir": "outputDir",
      "--prefix": "prefix",
      "--now": "now",
      "--soften-heat": "softenHeatAtOrBelow",
      "--soften-age-days": "softenAgeDays",
      "--max-insights": "maxInsights",
      "--sample-limit": "sampleLimit",
    };
    if (!map[name] || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${name}`);
    }
    options[map[name]] = value;
    index += 1;
  }
  if (!options.dbPath) {
    throw new Error(
      "Usage: node scripts/memory-v2-night-maintenance-dry-run.js --db FILE "
      + "[--output-dir DIR] [--now ISO] [--soften-heat N] "
      + "[--soften-age-days N] [--max-insights N]",
    );
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = runNightMaintenanceDryRun(options);
  const paths = writeReports(report, options);
  process.stdout.write(`${JSON.stringify({ ...paths, safety: report.safety }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[memory-v2-night-dry-run] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  renderMarkdown,
  runNightMaintenanceDryRun,
  writeReports,
};
