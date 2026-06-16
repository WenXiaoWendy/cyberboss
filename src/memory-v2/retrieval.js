const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MAX_SNIPPET_CHARS = 160;

class MemoryV2Retrieval {
  constructor({ dbPath } = {}) {
    this.dbPath = path.resolve(String(dbPath || ""));
  }

  retrieve(query, { limit = DEFAULT_LIMIT } = {}) {
    const terms = tokenizeQuery(query);
    if (!this.dbPath || !terms.length) {
      return { entries: [], prompt: "" };
    }
    if (!fs.statSync(this.dbPath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Memory V2 database does not exist: ${this.dbPath}`);
    }
    const db = new DatabaseSync(this.dbPath, { readOnly: true });
    try {
      db.exec("PRAGMA query_only = ON");
      assertRetrievalSchema(db);
      const clauses = terms.map(() => "LOWER(content) LIKE ? ESCAPE '\\'").join(" AND ");
      const params = terms.map((term) => `%${escapeLike(term.toLowerCase())}%`);
      const entries = db.prepare(`
        SELECT id, title, memory_type, status, heat, pinned, content,
               source_timestamp, source_role
        FROM memory_index
        WHERE status = 'active'
          AND ${clauses}
        ORDER BY pinned DESC, heat DESC, source_timestamp DESC, id ASC
        LIMIT ?
      `).all(...params, clampLimit(limit)).map(normalizeEntry);
      return { entries, prompt: renderRecallPrompt(entries) };
    } finally {
      db.close();
    }
  }
}

function assertRetrievalSchema(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(memory_index)").all()
    .map((row) => row.name));
  const required = [
    "id",
    "title",
    "memory_type",
    "status",
    "heat",
    "pinned",
    "content",
    "source_timestamp",
    "source_role",
  ];
  const missing = required.filter((name) => !columns.has(name));
  if (missing.length) {
    throw new Error(`Memory V2 retrieval schema is incomplete: ${missing.join(", ")}`);
  }
}

function renderRecallPrompt(entries) {
  if (!entries.length) {
    return "";
  }
  return [
    "MEMORY V2 RECALL CONTEXT",
    "Use these short active memory summaries only when they are relevant to the current reply.",
    "Do not mention memory IDs, database lookup, or recall logging to the user.",
    "Do not treat this directory as permission to write memory.",
    "",
    ...entries.map((entry) => (
      `- [${entry.id}] ${entry.title || entry.memoryType}: ${entry.snippet}`
    )),
  ].join("\n").trim();
}

function normalizeEntry(row) {
  return {
    id: row.id,
    title: row.title,
    memoryType: row.memory_type,
    status: row.status,
    heat: normalizeHeat(row.heat),
    pinned: Boolean(row.pinned),
    sourceTimestamp: row.source_timestamp,
    sourceRole: row.source_role,
    snippet: summarizeContent(row.content),
  };
}

function tokenizeQuery(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, MAX_LIMIT)) : DEFAULT_LIMIT;
}

function summarizeContent(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SNIPPET_CHARS);
}

function normalizeHeat(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

module.exports = {
  MemoryV2Retrieval,
  renderRecallPrompt,
};
