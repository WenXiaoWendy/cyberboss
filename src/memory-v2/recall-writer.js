const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const MIN_HEAT = 0.05;
const MAX_HEAT = 3.0;
const RECALL_HEAT_INCREMENT = 0.3;

class MemoryV2RecallWriter {
  constructor({
    dbPath,
    now = () => new Date().toISOString(),
    writeEnabled = false,
    backupGate = {},
  } = {}) {
    this.dbPath = requireDatabase(dbPath);
    this.now = now;
    this.writeEnabled = Boolean(writeEnabled);
    this.backupGate = normalizeBackupGate(backupGate);
  }

  searchDirectory(query, { limit = 10 } = {}) {
    const terms = tokenizeQuery(query);
    if (terms.length === 0) {
      return [];
    }
    return this.withReadOnlyDatabase((db) => {
      const clauses = terms.map(() => "LOWER(content) LIKE ? ESCAPE '\\'").join(" AND ");
      const params = terms.map((term) => `%${escapeLike(term.toLowerCase())}%`);
      return db.prepare(`
        SELECT id, title, memory_type, status, heat,
               COALESCE(last_recalled_at, last_recalled) AS last_recalled_at,
               recall_count, pinned, source_timestamp, source_role,
               source_message_ids
        FROM memory_index
        WHERE status = 'active'
          AND ${clauses}
        ORDER BY pinned DESC, heat DESC, source_timestamp DESC, id ASC
        LIMIT ?
      `).all(...params, clampLimit(limit)).map(toDirectoryEntry);
    });
  }

  getMetadata(id) {
    const memoryId = normalizeRequired(id, "memory id");
    return this.withReadOnlyDatabase((db) => {
      const row = db.prepare(`
        SELECT id, title, memory_type, status, heat,
               COALESCE(last_recalled_at, last_recalled) AS last_recalled_at,
               recall_count, pinned, source_timestamp, source_role,
               source_message_ids
        FROM memory_index
        WHERE id = ?
      `).get(memoryId);
      return row ? toDirectoryEntry(row) : null;
    });
  }

  peekBody(id) {
    const memoryId = normalizeRequired(id, "memory id");
    return this.withReadOnlyDatabase((db) => {
      const row = db.prepare(`
        SELECT *
        FROM memory_index
        WHERE id = ?
      `).get(memoryId);
      return row ? normalizeBody(row) : null;
    });
  }

  getRecallAudit(id) {
    const memoryId = normalizeRequired(id, "memory id");
    return this.withReadOnlyDatabase((db) => db.prepare(`
      SELECT id, event_id, memory_id, recalled_at, consumer, purpose,
             source_turn_id, heat_before, heat_after, created_at
      FROM memory_recall_audit
      WHERE memory_id = ?
      ORDER BY id ASC
    `).all(memoryId).map(normalizeAudit));
  }

  recall({
    id,
    eventId,
    consumer,
    purpose,
    sourceTurnId = null,
  } = {}) {
    this.assertWriteAllowed();
    const memoryId = normalizeRequired(id, "memory id");
    const recallEventId = normalizeRequired(eventId, "event id");
    const recallConsumer = normalizeRequired(consumer, "consumer");
    const recallPurpose = normalizeRequired(purpose, "purpose");
    const turnId = normalizeOptional(sourceTurnId);
    const recalledAt = normalizeTimestamp(this.now());
    const db = new DatabaseSync(this.dbPath);

    try {
      db.exec("PRAGMA foreign_keys = ON");
      assertRecallSchema(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = db.prepare(`
          SELECT event_id, memory_id, recalled_at, consumer, purpose,
                 source_turn_id, heat_before, heat_after, created_at
          FROM memory_recall_audit
          WHERE event_id = ?
        `).get(recallEventId);
        if (existing) {
          if (existing.memory_id !== memoryId) {
            throw new Error(
              `recall event ${recallEventId} belongs to another memory`,
            );
          }
          const current = db.prepare(`
            SELECT *
            FROM memory_index
            WHERE id = ?
          `).get(memoryId);
          db.exec("COMMIT");
          return {
            idempotent: true,
            event: normalizeAudit(existing),
            memory: current ? normalizeBody(current) : null,
          };
        }

        const before = db.prepare(`
          SELECT *
          FROM memory_index
          WHERE id = ?
        `).get(memoryId);
        if (!before) {
          throw new Error(`memory not found: ${memoryId}`);
        }
        if (before.status !== "active") {
          throw new Error(`memory is not active: ${before.status}`);
        }
        const result = db.prepare(`
          UPDATE memory_index
          SET heat = ROUND(MIN(3.0, MAX(0.05, heat) + 0.3), 3),
              last_recalled_at = ?,
              last_recalled = ?,
              recall_count = recall_count + 1,
              updated_at = ?
          WHERE id = ?
            AND status = 'active'
        `).run(recalledAt, recalledAt, recalledAt, memoryId);
        if (Number(result.changes) !== 1) {
          throw new Error(`recall update failed: ${memoryId}`);
        }
        const after = db.prepare(`
          SELECT *
          FROM memory_index
          WHERE id = ?
        `).get(memoryId);
        db.prepare(`
          INSERT INTO memory_recall_audit (
            event_id, memory_id, recalled_at, consumer, purpose,
            source_turn_id, heat_before, heat_after, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          recallEventId,
          memoryId,
          recalledAt,
          recallConsumer,
          recallPurpose,
          turnId,
          Number(before.heat),
          Number(after.heat),
          recalledAt,
        );
        const audit = db.prepare(`
          SELECT id, event_id, memory_id, recalled_at, consumer, purpose,
                 source_turn_id, heat_before, heat_after, created_at
          FROM memory_recall_audit
          WHERE event_id = ?
        `).get(recallEventId);
        db.exec("COMMIT");
        return {
          idempotent: false,
          event: normalizeAudit(audit),
          memory: normalizeBody(after),
        };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      db.close();
    }
  }

  assertWriteAllowed() {
    if (!this.writeEnabled) {
      throw new Error("Memory V2 recall writer is disabled");
    }
    if (!this.backupGate.verified) {
      throw new Error("Memory V2 recall writer requires a verified backup gate");
    }
    if (!this.backupGate.directory || !fs.statSync(this.backupGate.directory, {
      throwIfNoEntry: false,
    })?.isDirectory()) {
      throw new Error("Memory V2 recall writer backup directory is unavailable");
    }
    if (!/^[a-f0-9]{64}$/i.test(this.backupGate.sha256)) {
      throw new Error("Memory V2 recall writer backup SHA256 is invalid");
    }
  }

  withReadOnlyDatabase(callback) {
    const db = new DatabaseSync(this.dbPath, { readOnly: true });
    try {
      db.exec("PRAGMA query_only = ON");
      assertRecallSchema(db);
      return callback(db);
    } finally {
      db.close();
    }
  }
}

function assertRecallSchema(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(memory_index)").all()
    .map((row) => row.name));
  const tables = new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => row.name));
  const indexes = new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index'
  `).all().map((row) => row.name));
  const requiredColumns = [
    "heat",
    "last_recalled",
    "last_recalled_at",
    "recall_count",
    "pinned",
  ];
  const missing = requiredColumns.filter((name) => !columns.has(name));
  if (missing.length > 0) {
    throw new Error(`Memory V2 recall schema is incomplete: ${missing.join(", ")}`);
  }
  if (!tables.has("memory_recall_audit")) {
    throw new Error("Memory V2 recall schema is missing memory_recall_audit");
  }
  if (!indexes.has("idx_memory_recall_audit_memory_time")) {
    throw new Error(
      "Memory V2 recall schema is missing idx_memory_recall_audit_memory_time",
    );
  }
}

function normalizeBackupGate(value = {}) {
  return {
    verified: value.verified === true,
    directory: value.directory ? path.resolve(value.directory) : "",
    sha256: String(value.sha256 || "").trim().toLowerCase(),
  };
}

function requireDatabase(value) {
  const resolved = path.resolve(String(value || ""));
  if (!value || !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Memory V2 database does not exist: ${resolved}`);
  }
  return resolved;
}

function tokenizeQuery(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 50)) : 10;
}

function normalizeRequired(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function normalizeOptional(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid recall timestamp: ${value}`);
  }
  return date.toISOString();
}

function toDirectoryEntry(row) {
  return {
    id: row.id,
    title: row.title,
    memoryType: row.memory_type,
    status: row.status,
    heat: normalizeHeat(row.heat),
    lastRecalledAt: row.last_recalled_at || null,
    recallCount: Number(row.recall_count),
    pinned: Boolean(row.pinned),
    sourceTimestamp: row.source_timestamp,
    sourceRole: row.source_role,
    sourceMessageIds: parseJsonArray(row.source_message_ids),
  };
}

function normalizeBody(row) {
  return {
    ...toDirectoryEntry({
      ...row,
      last_recalled_at: row.last_recalled_at || row.last_recalled,
    }),
    content: row.content,
    sourceFile: row.source_file,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAudit(row) {
  return {
    id: row.id === undefined ? null : Number(row.id),
    eventId: row.event_id,
    memoryId: row.memory_id,
    recalledAt: row.recalled_at,
    consumer: row.consumer,
    purpose: row.purpose,
    sourceTurnId: row.source_turn_id || null,
    heatBefore: normalizeHeat(row.heat_before),
    heatAfter: normalizeHeat(row.heat_after),
    createdAt: row.created_at,
  };
}

function normalizeHeat(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = {
  MAX_HEAT,
  MIN_HEAT,
  MemoryV2RecallWriter,
  RECALL_HEAT_INCREMENT,
  assertRecallSchema,
};
