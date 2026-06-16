#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  runHealthCheck,
  writeReports: writeHealthReports,
} = require("./memory-v2-health-check");
const {
  runNightMaintenanceDryRun,
  writeReports: writeNightReports,
} = require("./memory-v2-night-maintenance-dry-run");

function runMaintenance({
  dbPath,
  outputRoot,
  now = new Date(),
  softenHeatAtOrBelow,
  softenAgeDays,
  maxInsights,
  sampleLimit,
} = {}) {
  const checkedAt = normalizeDate(now);
  const runId = `memory-v2-maintenance-${formatTimestamp(checkedAt)}`;
  const runDir = path.resolve(outputRoot || path.join(process.cwd(), "tmp", "memory-v2-maintenance"), runId);
  fs.mkdirSync(runDir, { recursive: true });

  const health = runHealthCheck({ dbPath, now: checkedAt, sampleLimit });
  const night = runNightMaintenanceDryRun({
    dbPath,
    now: checkedAt,
    softenHeatAtOrBelow,
    softenAgeDays,
    maxInsights,
    sampleLimit,
  });
  const healthPaths = writeHealthReports(health, {
    outputDir: runDir,
    prefix: "health",
  });
  const nightPaths = writeNightReports(night, {
    outputDir: runDir,
    prefix: "night-dry-run",
  });
  const manifest = {
    schemaVersion: 1,
    runId,
    checkedAt: checkedAt.toISOString(),
    database: path.resolve(dbPath),
    readOnly: true,
    health: {
      healthy: health.healthy,
      counts: health.counts,
      json: path.basename(healthPaths.jsonPath),
      markdown: path.basename(healthPaths.markdownPath),
    },
    nightDryRun: {
      proposalCounts: {
        softening: night.proposals.softening.count,
        staleGraphEdges: night.proposals.staleGraphEdges.count,
        duplicateMemories: night.proposals.duplicateMemories.count,
        factConflicts: night.proposals.factConflicts.count,
        insights: night.proposals.insights.count,
      },
      unsupported: [
        !night.proposals.staleGraphEdges.supported ? "staleGraphEdges" : null,
        !night.proposals.factConflicts.supported ? "factConflicts" : null,
      ].filter(Boolean),
      json: path.basename(nightPaths.jsonPath),
      markdown: path.basename(nightPaths.markdownPath),
    },
    safety: {
      databaseWrites: 0,
      l0Writes: 0,
      pm2Restarts: 0,
    },
  };
  const manifestPath = path.join(runDir, "manifest.json");
  const summaryPath = path.join(runDir, "summary.md");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(summaryPath, renderSummary(manifest), "utf8");
  return { runDir, manifestPath, summaryPath, manifest };
}

function renderSummary(manifest) {
  const proposals = manifest.nightDryRun.proposalCounts;
  return [
    "# Memory V2 Maintenance Summary",
    "",
    `Run: \`${manifest.runId}\``,
    `Checked: ${manifest.checkedAt}`,
    `Database: \`${manifest.database}\``,
    `Health: **${manifest.health.healthy ? "PASS" : "FAIL"}**`,
    "",
    "## Database Counts",
    "",
    `- active: ${manifest.health.counts.active}`,
    `- invalid: ${manifest.health.counts.invalid}`,
    `- pending: ${manifest.health.counts.pending}`,
    `- explicit skip: ${manifest.health.counts.skip}`,
    "",
    "## Night Dry-Run Proposals",
    "",
    `- softening: ${proposals.softening}`,
    `- stale graph edges: ${proposals.staleGraphEdges}`,
    `- duplicate memories: ${proposals.duplicateMemories}`,
    `- fact conflicts: ${proposals.factConflicts}`,
    `- insights: ${proposals.insights}`,
    `- unsupported checks: ${manifest.nightDryRun.unsupported.join(", ") || "none"}`,
    "",
    "## Safety",
    "",
    "- Database writes: 0",
    "- L0 writes: 0",
    "- PM2 restarts: 0",
    "",
    "See `health.md` and `night-dry-run.md` for evidence and samples.",
    "",
  ].join("\n");
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid maintenance time: ${value}`);
  }
  return date;
}

function formatTimestamp(value) {
  return normalizeDate(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv) {
  const options = {};
  const mapping = {
    "--db": "dbPath",
    "--output-root": "outputRoot",
    "--now": "now",
    "--soften-heat": "softenHeatAtOrBelow",
    "--soften-age-days": "softenAgeDays",
    "--max-insights": "maxInsights",
    "--sample-limit": "sampleLimit",
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
  if (!options.dbPath) {
    throw new Error(
      "Usage: node scripts/memory-v2-maintenance.js --db FILE "
      + "[--output-root DIR] [--now ISO]",
    );
  }
  return options;
}

if (require.main === module) {
  try {
    const result = runMaintenance(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({
      runDir: result.runDir,
      summaryPath: result.summaryPath,
      healthy: result.manifest.health.healthy,
    }, null, 2)}\n`);
    process.exitCode = result.manifest.health.healthy ? 0 : 2;
  } catch (error) {
    process.stderr.write(`[memory-v2-maintenance] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  renderSummary,
  runMaintenance,
};
