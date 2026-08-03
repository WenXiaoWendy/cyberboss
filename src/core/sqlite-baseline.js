const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function captureSqliteBaseline(databasePath) {
  const normalized = normalizeDatabasePath(databasePath);
  return {
    databasePath: normalized,
    hash: sha256File(normalized),
    walExists: fs.existsSync(`${normalized}-wal`),
    shmExists: fs.existsSync(`${normalized}-shm`),
  };
}

function compareSqliteBaseline(baseline) {
  const normalized = normalizeDatabasePath(baseline?.databasePath);
  const hashUnchanged = sha256File(normalized) === baseline?.hash;
  const walUnchanged = fs.existsSync(`${normalized}-wal`) === Boolean(baseline?.walExists);
  const shmUnchanged = fs.existsSync(`${normalized}-shm`) === Boolean(baseline?.shmExists);
  return {
    databasePath: normalized,
    hashUnchanged,
    walUnchanged,
    shmUnchanged,
    unchanged: hashUnchanged && walUnchanged && shmUnchanged,
  };
}

function normalizeDatabasePath(databasePath) {
  const normalized = typeof databasePath === "string" ? databasePath.trim() : "";
  if (!normalized) {
    throw new Error("SQLite baseline requires a database path.");
  }
  const resolved = path.resolve(normalized);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("SQLite baseline database is unavailable.");
  }
  return resolved;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

module.exports = {
  captureSqliteBaseline,
  compareSqliteBaseline,
};
