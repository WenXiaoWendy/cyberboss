const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const {
  createBackup,
  listBackupDirs,
  restoreBackup,
  runGuardedCommand,
  verifyBackup,
} = require("../scripts/memory-v2-backup");

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-v2-backup-"));
  const dbPath = path.join(root, "memory-v2.sqlite");
  const backupRoot = path.join(root, "backups");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE value_store (value TEXT)");
  db.prepare("INSERT INTO value_store VALUES (?)").run("before");
  db.close();
  return { root, dbPath, backupRoot };
}

function readValue(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT value FROM value_store").get().value;
  } finally {
    db.close();
  }
}

test("creates an online timestamped backup with SHA256 and integrity evidence", async () => {
  const fixture = createFixture();
  const result = await createBackup({
    dbPath: fixture.dbPath,
    backupRoot: fixture.backupRoot,
    label: "test-write",
    now: "2026-06-15T08:09:10.000Z",
    retain: 5,
  });

  assert.match(path.basename(result.backupDir), /^memory-v2-20260615T080910Z-test-write$/);
  assert.equal(result.databaseSha256.length, 64);
  assert.equal(result.integrity, "ok");
  assert.equal(readValue(result.databasePath), "before");
  assert.equal(verifyBackup({ backupDir: result.backupDir }).ok, true);
});

test("retains only the newest N completed backups", async () => {
  const fixture = createFixture();
  for (let day = 1; day <= 4; day += 1) {
    await createBackup({
      dbPath: fixture.dbPath,
      backupRoot: fixture.backupRoot,
      label: "retention",
      now: `2026-06-0${day}T00:00:00.000Z`,
      retain: 2,
    });
  }

  const dirs = listBackupDirs(fixture.backupRoot);
  assert.equal(dirs.length, 2);
  assert.match(path.basename(dirs[0]), /20260603/);
  assert.match(path.basename(dirs[1]), /20260604/);
});

test("guard does not start a command when backup creation fails", async () => {
  const fixture = createFixture();
  const marker = path.join(fixture.root, "marker.txt");

  await assert.rejects(
    runGuardedCommand({
      dbPath: path.join(fixture.root, "missing.sqlite"),
      backupRoot: fixture.backupRoot,
      command: process.execPath,
      args: ["-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
    }),
    /does not exist/,
  );
  assert.equal(fs.existsSync(marker), false);
});

test("guard creates and verifies backup before starting the write command", async () => {
  const fixture = createFixture();
  const marker = path.join(fixture.root, "marker.txt");
  const result = await runGuardedCommand({
    dbPath: fixture.dbPath,
    backupRoot: fixture.backupRoot,
    label: "guarded",
    retain: 5,
    command: process.execPath,
    args: [
      "-e",
      `require('fs').writeFileSync(${JSON.stringify(marker)}, process.env.MEMORY_V2_BACKUP_VERIFIED)`,
    ],
    now: "2026-06-15T10:00:00.000Z",
  });

  assert.equal(result.status, 0);
  assert.equal(fs.readFileSync(marker, "utf8"), "true");
  assert.equal(verifyBackup({ backupDir: result.backup.backupDir }).ok, true);
});

test("restore requires the expected hash and preserves a pre-restore backup", async () => {
  const fixture = createFixture();
  const saved = await createBackup({
    dbPath: fixture.dbPath,
    backupRoot: fixture.backupRoot,
    label: "known-good",
    now: "2026-06-15T11:00:00.000Z",
    retain: 10,
  });
  const db = new DatabaseSync(fixture.dbPath);
  db.exec("UPDATE value_store SET value = 'after'");
  db.close();

  await assert.rejects(
    restoreBackup({
      dbPath: fixture.dbPath,
      backupDir: saved.backupDir,
      backupRoot: fixture.backupRoot,
    }),
    /expected-sha256/,
  );
  const restored = await restoreBackup({
    dbPath: fixture.dbPath,
    backupDir: saved.backupDir,
    backupRoot: fixture.backupRoot,
    expectedSha256: saved.databaseSha256,
    retain: 10,
    now: "2026-06-15T12:00:00.000Z",
  });

  assert.equal(restored.restored, true);
  assert.equal(readValue(fixture.dbPath), "before");
  assert.match(path.basename(restored.preRestoreBackup), /pre-restore$/);
  assert.equal(verifyBackup({ backupDir: restored.preRestoreBackup }).ok, true);
});
