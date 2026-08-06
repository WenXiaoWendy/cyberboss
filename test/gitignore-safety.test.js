const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

function isIgnored(relativePath) {
  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", relativePath],
    { cwd: repoRoot, encoding: "utf8", shell: false },
  );
  assert.equal(result.error, undefined);
  return result.status === 0;
}

test("private runtime state and acceptance artifacts are ignored without hiding source", () => {
  for (const relativePath of [
    ".cyberboss/accounts/account.json",
    "accounts/account.json",
    "sync-buffers/cursor.json",
    "evidence/q5.json",
    "logs/bridge.log",
    "sessions.json",
    "memory.sqlite3",
    "memory.sqlite3-wal",
    "memory.sqlite3-shm",
  ]) {
    assert.equal(isIgnored(relativePath), true, `${relativePath} must be ignored`);
  }
  assert.equal(isIgnored("src/core/app.js"), false);
});
