const { redactMaybeSensitive } = require("./redact");

function formatTextReport(report) {
  const safeReport = redactMaybeSensitive(report);
  const lines = [
    "Cyberboss Doctor",
    "",
    `summary: ${safeReport?.summary?.status || "unknown"}`,
    `schema: ${safeReport?.schemaVersion || 1}`,
  ];

  for (const group of safeReport.groups || []) {
    lines.push("");
    lines.push(`${group.title || group.id}: ${group.status || "unknown"}`);
    const checks = Array.isArray(group.checks) ? group.checks : [];
    for (const check of checks.filter((item) => item.status !== "ok")) {
      lines.push(`[${check.status}] ${check.id}`);
      if (check.category) {
        lines.push(`  category: ${check.category}`);
      }
      const evidence = formatEvidence(check.evidence);
      if (evidence) {
        lines.push(`  evidence: ${evidence}`);
      }
      if (check.recommendation) {
        lines.push(`  recommendation: ${check.recommendation}`);
      }
    }
  }

  return lines.join("\n");
}

function formatEvidence(evidence = {}) {
  if (!evidence || typeof evidence !== "object") {
    return "";
  }
  return Object.entries(evidence)
    .map(([key, value]) => `${key}=${formatEvidenceValue(value)}`)
    .join(" ");
}

function formatEvidenceValue(value) {
  if (value == null) {
    return "";
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatEvidenceValue).join(",")}]`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

module.exports = { formatTextReport };
