const VALID_STATUSES = new Set(["ok", "warn", "fail", "skip", "unknown"]);
const STATUS_RANK = { fail: 4, unknown: 3, warn: 2, skip: 1, ok: 0 };

function createCheck({
  id,
  title,
  status = "ok",
  severity = "",
  category = "state",
  evidence = {},
  recommendation = "",
  privacy = { redacted: true },
} = {}) {
  const normalizedStatus = normalizeStatus(status);
  const normalizedId = normalizeText(id);
  return {
    id: normalizedId,
    title: normalizeText(title) || normalizedId,
    status: normalizedStatus,
    severity: normalizeText(severity) || defaultSeverity(normalizedStatus),
    category: normalizeText(category) || "state",
    evidence: evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence : {},
    recommendation: normalizeText(recommendation),
    privacy: privacy && typeof privacy === "object" && !Array.isArray(privacy) ? privacy : { redacted: true },
  };
}

function createGroup({ id, title, checks = [] } = {}) {
  const normalizedChecks = Array.isArray(checks) ? checks : [];
  const normalizedId = normalizeText(id);
  return {
    id: normalizedId,
    title: normalizeText(title) || normalizedId,
    status: summarizeChecks(normalizedChecks),
    checks: normalizedChecks,
  };
}

function summarizeGroups(groups = []) {
  const checks = groups.flatMap((group) => Array.isArray(group?.checks) ? group.checks : []);
  return {
    status: summarizeChecks(checks),
    issueCount: checks.filter((check) => check.status === "fail").length,
    warningCount: checks.filter((check) => check.status === "warn").length,
    skippedCount: checks.filter((check) => check.status === "skip").length,
    unknownCount: checks.filter((check) => check.status === "unknown").length,
  };
}

function summarizeChecks(checks = []) {
  const normalizedChecks = Array.isArray(checks) ? checks : [];
  if (!normalizedChecks.length) {
    return "ok";
  }
  const statuses = normalizedChecks.map((check) => normalizeStatus(check?.status));
  const rankedStatuses = statuses.some((status) => status !== "skip")
    ? statuses.filter((status) => status !== "skip")
    : statuses;
  return rankedStatuses
    .sort((left, right) => STATUS_RANK[right] - STATUS_RANK[left])[0] || "ok";
}

function normalizeStatus(status) {
  const normalized = normalizeText(status).toLowerCase();
  return VALID_STATUSES.has(normalized) ? normalized : "unknown";
}

function defaultSeverity(status) {
  switch (normalizeStatus(status)) {
    case "fail": return "error";
    case "warn":
    case "unknown": return "warning";
    default: return "info";
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  createCheck,
  createGroup,
  defaultSeverity,
  normalizeStatus,
  normalizeText,
  summarizeChecks,
  summarizeGroups,
};
