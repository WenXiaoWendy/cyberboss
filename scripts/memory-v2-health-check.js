#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_SAMPLE_LIMIT = 20;
const REQUIRED_TABLES = ["memory_index", "memory_review_audit"];

function runHealthCheck({
  dbPath,
  now = new Date(),
  sampleLimit = DEFAULT_SAMPLE_LIMIT,
} = {}) {
  const resolvedDbPath = path.resolve(String(dbPath || ""));
  if (!dbPath || !fs.existsSync(resolvedDbPath)) {
    throw new Error(`Memory V2 database does not exist: ${resolvedDbPath}`);
  }

  const checkedAt = normalizeDate(now).toISOString();
  const cutoff = new Date(normalizeDate(now).getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString();
  const db = new DatabaseSync(resolvedDbPath, { readOnly: true });

  try {
    db.exec("PRAGMA query_only = ON");
    const tableNames = new Set(db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `).all().map((row) => row.name));
    const missingTables = REQUIRED_TABLES.filter((name) => !tableNames.has(name));
    if (missingTables.length > 0) {
      throw new Error(`Memory V2 database is missing tables: ${missingTables.join(", ")}`);
    }

    const columns = getColumns(db, "memory_index");
    const auditColumns = getColumns(db, "memory_review_audit");
    const requiredColumns = [
      "id", "status", "content", "pinned", "last_recalled",
    ];
    const missingColumns = requiredColumns.filter((name) => !columns.has(name));
    if (missingColumns.length > 0) {
      throw new Error(`memory_index is missing columns: ${missingColumns.join(", ")}`);
    }
    if (!auditColumns.has("memory_id") || !auditColumns.has("note")) {
      throw new Error("memory_review_audit is missing memory_id or note");
    }

    const integrityRows = db.prepare("PRAGMA integrity_check").all();
    const integrityMessages = integrityRows.map((row) => String(
      row.integrity_check ?? Object.values(row)[0] ?? "",
    ));
    const integrityOk = integrityMessages.length === 1 && integrityMessages[0] === "ok";
    const stateCounts = Object.fromEntries(
      db.prepare(`
        SELECT status, COUNT(*) AS count
        FROM memory_index
        GROUP BY status
      `).all().map((row) => [row.status, Number(row.count)]),
    );
    const total = Object.values(stateCounts).reduce((sum, count) => sum + count, 0);

    const rows = db.prepare("SELECT * FROM memory_index ORDER BY id").all();
    const latestAudit = loadLatestAudit(db);
    const pendingWithoutReason = rows
      .filter((row) => row.status === "pending")
      .filter((row) => {
        const audit = latestAudit.get(row.id);
        return !audit || audit.action !== "skip" || !String(audit.note || "").trim();
      })
      .map((row) => issueMemory(row, {
        reason: latestAudit.has(row.id)
          ? "Latest pending audit is not an explicit skip with a non-empty note."
          : "No review audit explains why this record remains pending.",
      }));

    const duplicateActive = findDuplicateActive(rows);
    const pollution = rows
      .map((row) => ({ row, matches: detectPollution(row) }))
      .filter((item) => item.matches.length > 0)
      .map(({ row, matches }) => issueMemory(row, {
        reason: matches.join(", "),
      }));
    const activePollution = pollution.filter((item) => item.status === "active");
    const pendingPollution = pollution.filter((item) => item.status === "pending");

    const summaryColumn = firstColumn(columns, ["summary", "title"]);
    const sourceColumn = firstColumn(
      columns,
      ["source", "source_file", "source_key", "source_message_ids"],
    );
    const sourceColumns = sourceColumn ? [sourceColumn] : [];
    const reasonColumn = firstColumn(columns, ["reason", "review_reason"]);
    const emptySummary = summaryColumn
      ? rows.filter((row) => isBlank(row[summaryColumn])).map(issueMemory)
      : [];
    const emptySource = sourceColumn
      ? rows.filter((row) => isBlank(row[sourceColumn])).map(issueMemory)
      : rows.map(issueMemory);
    const emptyReason = reasonColumn
      ? rows.filter((row) => isBlank(row[reasonColumn])).map(issueMemory)
      : db.prepare(`
          SELECT id, memory_id, action, note, created_at
          FROM memory_review_audit
          WHERE TRIM(COALESCE(note, '')) = ''
          ORDER BY id
        `).all().map((row) => ({
          auditId: Number(row.id),
          memoryId: row.memory_id,
          action: row.action,
          createdAt: row.created_at,
          reason: "Review audit note is empty.",
        }));

    const pinnedInvalid = rows
      .filter((row) => Boolean(row.pinned) && row.status === "invalid")
      .map(issueMemory);
    const recentlyRecalledInvalid = rows
      .filter((row) => (
        row.status === "invalid"
        && isValidDate(row.last_recalled)
        && new Date(row.last_recalled).getTime() >= new Date(cutoff).getTime()
      ))
      .map(issueMemory);

    const checks = {
      integrity: checkResult(integrityOk, {
        count: integrityOk ? 0 : integrityMessages.length,
        details: integrityMessages,
      }),
      pendingReasons: checkResult(pendingWithoutReason.length === 0, {
        count: pendingWithoutReason.length,
        samples: sample(pendingWithoutReason, sampleLimit),
      }),
      duplicateActive: checkResult(duplicateActive.length === 0, {
        count: duplicateActive.length,
        samples: sample(duplicateActive, sampleLimit),
      }),
      activePollution: checkResult(activePollution.length === 0, {
        count: activePollution.length,
        samples: sample(activePollution, sampleLimit),
      }),
      pendingPollution: checkResult(pendingPollution.length === 0, {
        count: pendingPollution.length,
        samples: sample(pendingPollution, sampleLimit),
      }),
      emptySummary: checkResult(emptySummary.length === 0, {
        count: emptySummary.length,
        field: summaryColumn,
        unsupported: !summaryColumn,
        samples: sample(emptySummary, sampleLimit),
      }),
      emptySource: checkResult(emptySource.length === 0, {
        count: emptySource.length,
        fields: sourceColumns,
        unsupported: sourceColumns.length === 0,
        samples: sample(emptySource, sampleLimit),
      }),
      emptyReason: checkResult(emptyReason.length === 0, {
        count: emptyReason.length,
        field: reasonColumn || "memory_review_audit.note",
        samples: sample(emptyReason, sampleLimit),
      }),
      pinnedInvalid: checkResult(pinnedInvalid.length === 0, {
        count: pinnedInvalid.length,
        samples: sample(pinnedInvalid, sampleLimit),
      }),
      recentlyRecalledInvalid: checkResult(recentlyRecalledInvalid.length === 0, {
        count: recentlyRecalledInvalid.length,
        cutoff,
        samples: sample(recentlyRecalledInvalid, sampleLimit),
      }),
    };

    const criticalChecks = [
      "integrity",
      "pendingReasons",
      "duplicateActive",
      "activePollution",
      "pinnedInvalid",
      "recentlyRecalledInvalid",
    ];
    return {
      schemaVersion: 1,
      checkedAt,
      database: resolvedDbPath,
      readOnly: true,
      healthy: criticalChecks.every((name) => checks[name].ok),
      counts: {
        total,
        active: stateCounts.active || 0,
        invalid: stateCounts.invalid || 0,
        pending: stateCounts.pending || 0,
        skip: rows.filter((row) => (
          row.status === "pending" && latestAudit.get(row.id)?.action === "skip"
        )).length,
        pinned: rows.filter((row) => Boolean(row.pinned)).length,
        auditRows: Number(db.prepare(
          "SELECT COUNT(*) AS count FROM memory_review_audit",
        ).get().count),
      },
      schema: {
        memoryIndexColumns: Array.from(columns).sort(),
        auditColumns: Array.from(auditColumns).sort(),
        summaryField: summaryColumn,
        sourceFields: sourceColumns,
        reasonField: reasonColumn || "memory_review_audit.note",
      },
      checks,
    };
  } finally {
    db.close();
  }
}

function writeReports(report, { outputDir, prefix = "memory-health" } = {}) {
  const resolvedOutputDir = path.resolve(outputDir || process.cwd());
  fs.mkdirSync(resolvedOutputDir, { recursive: true });
  const safePrefix = String(prefix || "memory-health").replace(/[^a-zA-Z0-9._-]/g, "_");
  const jsonPath = path.join(resolvedOutputDir, `${safePrefix}.json`);
  const markdownPath = path.join(resolvedOutputDir, `${safePrefix}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

function renderMarkdown(report) {
  const lines = [
    "# Memory V2 Health Check",
    "",
    `Checked: ${report.checkedAt}`,
    `Database: \`${report.database}\``,
    `Database opened read-only: ${report.readOnly ? "yes" : "no"}`,
    `Overall critical health: **${report.healthy ? "PASS" : "FAIL"}**`,
    "",
    "## Counts",
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| total | ${report.counts.total} |`,
    `| active | ${report.counts.active} |`,
    `| invalid | ${report.counts.invalid} |`,
    `| pending | ${report.counts.pending} |`,
    `| explicit skip | ${report.counts.skip} |`,
    `| pinned | ${report.counts.pinned} |`,
    `| audit rows | ${report.counts.auditRows} |`,
    "",
    "## Checks",
    "",
    "| Check | Result | Findings |",
    "| --- | --- | ---: |",
  ];
  for (const [name, check] of Object.entries(report.checks)) {
    lines.push(`| ${name} | ${check.ok ? "PASS" : "FAIL"} | ${check.count} |`);
  }
  lines.push("", "## Findings", "");
  for (const [name, check] of Object.entries(report.checks)) {
    lines.push(`### ${name}`, "");
    if (check.unsupported) {
      lines.push("The current schema does not expose a compatible field.", "");
    } else if (check.ok) {
      lines.push("No findings.", "");
    } else {
      lines.push(`Findings: ${check.count}`, "");
      lines.push("```json", JSON.stringify(check.samples || check.details, null, 2), "```", "");
    }
  }
  return `${lines.join("\n")}\n`;
}

function loadLatestAudit(db) {
  const map = new Map();
  for (const row of db.prepare(`
    SELECT a.memory_id, a.action, a.note, a.created_at
    FROM memory_review_audit a
    INNER JOIN (
      SELECT memory_id, MAX(id) AS max_id
      FROM memory_review_audit
      GROUP BY memory_id
    ) latest ON latest.max_id = a.id
  `).all()) {
    map.set(row.memory_id, row);
  }
  return map;
}

function findDuplicateActive(rows) {
  const groups = new Map();
  for (const row of rows.filter((item) => item.status === "active")) {
    const key = normalizeDuplicateText(row.content);
    if (!key) {
      continue;
    }
    const group = groups.get(key) || [];
    group.push(issueMemory(row));
    groups.set(key, group);
  }
  return Array.from(groups.entries())
    .filter(([, memories]) => memories.length > 1)
    .map(([normalizedContent, memories]) => ({
      normalizedContent: truncate(normalizedContent, 160),
      count: memories.length,
      memories,
    }));
}

function detectPollution(row) {
  const text = [
    row.title,
    row.content,
    row.summary,
  ].filter(Boolean).join("\n").normalize("NFKC").toLowerCase();
  const patterns = [
    ["system trigger", /system action mode:|internal trigger,\s*not user chat|^\s*\[system\]|<system(?:_|\s|>)/m],
    ["skill injection", /<skill>|<\/skill>|skill\.md|intimate-writing-explicit|available skills|skills_instructions/],
    ["tool log", /tool_(?:result|use)|mcp tool|functions\.[a-z0-9_-]+|exec_command|shell_command/],
    ["refusal boilerplate", /i can(?:not|'t) assist with that|i(?:'m| am) unable to help with that request|抱歉[，,]?(?:我)?(?:不能|无法)(?:协助|帮助|提供)/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function issueMemory(row, extra = {}) {
  return {
    id: row.id,
    status: row.status,
    pinned: Boolean(row.pinned),
    title: truncate(row.title, 120),
    preview: truncate(row.content ?? row.summary, 180),
    sourceFile: row.source_file || row.source || null,
    lastRecalled: row.last_recalled || null,
    ...extra,
  };
}

function checkResult(ok, detail) {
  return { ok, ...detail };
}

function getColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function firstColumn(columns, candidates) {
  return candidates.find((name) => columns.has(name)) || null;
}

function normalizeDuplicateText(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function isValidDate(value) {
  return !isBlank(value) && Number.isFinite(Date.parse(value));
}

function truncate(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function sample(items, limit) {
  return items.slice(0, Math.max(1, Number(limit) || DEFAULT_SAMPLE_LIMIT));
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid health-check time: ${value}`);
  }
  return date;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === "--db") {
      options.dbPath = value;
      index += 1;
    } else if (name === "--output-dir") {
      options.outputDir = value;
      index += 1;
    } else if (name === "--prefix") {
      options.prefix = value;
      index += 1;
    } else if (name === "--now") {
      options.now = value;
      index += 1;
    } else if (name === "--sample-limit") {
      options.sampleLimit = Number.parseInt(value, 10);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${name}`);
    }
  }
  if (!options.dbPath) {
    throw new Error(
      "Usage: node scripts/memory-v2-health-check.js --db FILE "
      + "[--output-dir DIR] [--prefix NAME] [--now ISO] [--sample-limit N]",
    );
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = runHealthCheck(options);
  const timestamp = report.checkedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const paths = writeReports(report, {
    outputDir: options.outputDir || path.join(process.cwd(), "tmp", "memory-health-reports"),
    prefix: options.prefix || `memory-health-${timestamp}`,
  });
  process.stdout.write(`${JSON.stringify({ ...paths, healthy: report.healthy }, null, 2)}\n`);
  process.exitCode = report.healthy ? 0 : 2;
}

if (require.main === module) {
  main();
}

module.exports = {
  detectPollution,
  renderMarkdown,
  runHealthCheck,
  writeReports,
};
