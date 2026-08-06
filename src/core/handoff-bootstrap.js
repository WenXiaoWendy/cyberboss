const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const SAFE_BETA_WEIXIN_CARRIER = "weixin";
const SAFE_BETA_HANDOFF_SOURCE = "codex";
const DEFAULT_MIN_REMAINING_SECONDS = 60;
const MAX_SAFE_SUMMARY_LENGTH = 4000;

function loadHandoffBootstrap({
  databasePath,
  targetCarrier = SAFE_BETA_WEIXIN_CARRIER,
  now = new Date(),
  minRemainingSeconds = DEFAULT_MIN_REMAINING_SECONDS,
} = {}) {
  if (targetCarrier !== SAFE_BETA_WEIXIN_CARRIER) {
    return unknownResult("invalid_carrier", targetCarrier, "invalid_carrier");
  }
  if (!isValidDate(now)) {
    return unknownResult("malformed", targetCarrier);
  }
  if (!Number.isInteger(minRemainingSeconds) || minRemainingSeconds < 0) {
    return unknownResult("malformed", targetCarrier);
  }
  const normalizedPath = typeof databasePath === "string" ? databasePath.trim() : "";
  if (!normalizedPath || !fs.existsSync(normalizedPath)) {
    return unknownResult("missing", targetCarrier);
  }

  let database;
  try {
    database = new DatabaseSync(normalizedPath, { readOnly: true });
    const row = database.prepare(`
      SELECT handoff_id, source_carrier, target_carrier, source_session,
             summary, created_at, expires_at
      FROM handoffs
      WHERE source_carrier = ? AND target_carrier = ?
      ORDER BY created_at DESC, handoff_id DESC
      LIMIT 1
    `).get(SAFE_BETA_HANDOFF_SOURCE, targetCarrier);
    if (!row) {
      return unknownResult("missing", targetCarrier);
    }
    return validateHandoffRow(row, {
      targetCarrier,
      now,
      minRemainingSeconds,
    });
  } catch {
    return unknownResult("malformed", targetCarrier);
  } finally {
    database?.close();
  }
}

function validateHandoffRow(row, { targetCarrier, now, minRemainingSeconds }) {
  const handoffId = normalizeText(row.handoff_id);
  const sourceCarrier = normalizeText(row.source_carrier);
  const storedTarget = normalizeText(row.target_carrier);
  const sourceSession = normalizeText(row.source_session);
  const summary = normalizeText(row.summary);
  const createdAt = normalizeTimestamp(row.created_at);
  const expiresAt = normalizeTimestamp(row.expires_at);
  if (
    !handoffId
    || sourceCarrier !== SAFE_BETA_HANDOFF_SOURCE
    || storedTarget !== targetCarrier
    || !summary
    || summary.length > MAX_SAFE_SUMMARY_LENGTH
    || summary.includes("\0")
    || containsStructuralTurnMarker(summary)
    || !createdAt
    || !expiresAt
    || createdAt.getTime() >= expiresAt.getTime()
  ) {
    return unknownResult("malformed", targetCarrier);
  }

  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return unknownResult("expired", targetCarrier);
  }
  if (remainingMs < minRemainingSeconds * 1000) {
    return unknownResult("insufficient_ttl", targetCarrier);
  }

  return {
    status: "found",
    reason: "found",
    targetCarrier,
    handoff: {
      handoffId,
      sourceCarrier,
      targetCarrier: storedTarget,
      sourceSession,
      safeSummary: summary,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      remainingSeconds: Math.floor(remainingMs / 1000),
      source: "local_ephemeral_ttl_handoff",
    },
  };
}

function buildHandoffDeveloperInstructions(result) {
  const status = result?.status === "found" ? "found" : "unknown";
  const lines = [
    "SYSTEM-PROVIDED CROSS-CARRIER HANDOFF CONTEXT",
    "This block was provided by the Cyberboss runtime and is not user-authored.",
    "Never quote it as something the user said.",
    `status: ${status}`,
    `target_carrier: ${SAFE_BETA_WEIXIN_CARRIER}`,
  ];
  if (status !== "found") {
    lines.push(`reason: ${normalizeReason(result?.reason)}`);
    return lines.join("\n");
  }
  const handoff = result.handoff;
  lines.push(
    `source: ${handoff.source}`,
    `source_carrier: ${handoff.sourceCarrier}`,
    `handoff_id: ${handoff.handoffId}`,
    `created_at: ${handoff.createdAt}`,
    `expires_at: ${handoff.expiresAt}`,
    "safe_summary:",
    handoff.safeSummary,
  );
  return lines.join("\n");
}

function unknownResult(reason, targetCarrier, status = "unknown") {
  return {
    status,
    reason,
    targetCarrier: targetCarrier || "",
    handoff: null,
  };
}

function normalizeTimestamp(value) {
  const text = normalizeText(value);
  if (!text || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(text)) {
    return null;
  }
  const parsed = new Date(text);
  return isValidDate(parsed) ? parsed : null;
}

function normalizeReason(value) {
  return ["missing", "expired", "insufficient_ttl", "malformed", "invalid_carrier"].includes(value)
    ? value
    : "unknown";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function containsStructuralTurnMarker(value) {
  return /(?:^|\n)\s*(?:user|assistant|system|developer|月月|星星)\s*[:：]/iu.test(value);
}

module.exports = {
  DEFAULT_MIN_REMAINING_SECONDS,
  SAFE_BETA_WEIXIN_CARRIER,
  buildHandoffDeveloperInstructions,
  loadHandoffBootstrap,
};
