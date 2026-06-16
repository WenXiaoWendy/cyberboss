#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { DatabaseSync, backup } = require("node:sqlite");

const BACKUP_PREFIX = "memory-v2-";

async function createBackup({
  dbPath,
  backupRoot,
  label = "write",
  retain = 20,
  now = new Date(),
  prune = true,
} = {}) {
  const sourcePath = requireExistingFile(dbPath, "database");
  const root = path.resolve(String(backupRoot || ""));
  if (!backupRoot) {
    throw new Error("Backup root is required");
  }
  const timestamp = formatTimestamp(now);
  const safeLabel = sanitizeLabel(label);
  const finalDir = path.join(root, `${BACKUP_PREFIX}${timestamp}-${safeLabel}`);
  const stagingDir = `${finalDir}.staging-${process.pid}-${crypto.randomUUID()}`;
  const backupPath = path.join(stagingDir, "memory-v2.sqlite");

  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.existsSync(finalDir)) {
    throw new Error(`Backup directory already exists: ${finalDir}`);
  }
  fs.mkdirSync(stagingDir, { mode: 0o700 });

  let sourceDb;
  try {
    sourceDb = new DatabaseSync(sourcePath, { readOnly: true });
    sourceDb.exec("PRAGMA query_only = ON");
    const sourceIntegrity = readIntegrity(sourceDb);
    if (!sourceIntegrity.ok) {
      throw new Error(`Source database integrity failed: ${sourceIntegrity.messages.join("; ")}`);
    }
    await backup(sourceDb, backupPath);
    sourceDb.close();
    sourceDb = null;

    const backupIntegrity = inspectDatabase(backupPath);
    if (!backupIntegrity.ok) {
      throw new Error(`Backup database integrity failed: ${backupIntegrity.messages.join("; ")}`);
    }
    const databaseSha256 = sha256File(backupPath);
    const databaseSize = fs.statSync(backupPath).size;
    const manifest = {
      schemaVersion: 1,
      createdAt: normalizeDate(now).toISOString(),
      label: safeLabel,
      sourceDatabase: sourcePath,
      backupDatabase: "memory-v2.sqlite",
      databaseSize,
      databaseSha256,
      integrity: backupIntegrity.messages,
      verified: true,
    };
    fs.writeFileSync(
      path.join(stagingDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(stagingDir, "SHA256SUMS"),
      `${databaseSha256}  memory-v2.sqlite\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    fs.renameSync(stagingDir, finalDir);
    const verified = verifyBackup({ backupDir: finalDir });
    if (!verified.ok) {
      throw new Error(`Published backup verification failed: ${verified.errors.join("; ")}`);
    }
    const retention = prune
      ? pruneBackups({ backupRoot: root, retain, protectedDirs: [finalDir] })
      : { retained: listBackupDirs(root).length, removed: [] };
    return {
      backupDir: finalDir,
      manifestPath: path.join(finalDir, "manifest.json"),
      databasePath: path.join(finalDir, "memory-v2.sqlite"),
      databaseSha256,
      databaseSize,
      integrity: "ok",
      retention,
    };
  } catch (error) {
    if (sourceDb) {
      sourceDb.close();
    }
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function verifyBackup({ backupDir, expectedSha256 = "" } = {}) {
  const resolvedDir = path.resolve(String(backupDir || ""));
  const errors = [];
  const manifestPath = path.join(resolvedDir, "manifest.json");
  const backupPath = path.join(resolvedDir, "memory-v2.sqlite");
  let manifest = null;

  if (!fs.existsSync(manifestPath)) {
    errors.push("manifest.json is missing");
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
      errors.push(`manifest.json is invalid: ${error.message}`);
    }
  }
  if (!fs.existsSync(backupPath)) {
    errors.push("memory-v2.sqlite is missing");
  }
  let actualSha256 = "";
  let integrity = { ok: false, messages: [] };
  if (fs.existsSync(backupPath)) {
    actualSha256 = sha256File(backupPath);
    try {
      integrity = inspectDatabase(backupPath);
      if (!integrity.ok) {
        errors.push(`integrity check failed: ${integrity.messages.join("; ")}`);
      }
    } catch (error) {
      errors.push(`database cannot be opened: ${error.message}`);
    }
  }
  if (manifest?.databaseSha256 && actualSha256 !== manifest.databaseSha256) {
    errors.push("database SHA256 does not match manifest");
  }
  if (expectedSha256 && actualSha256 !== normalizeSha(expectedSha256)) {
    errors.push("database SHA256 does not match --expected-sha256");
  }
  if (
    manifest?.databaseSize !== undefined
    && fs.existsSync(backupPath)
    && Number(manifest.databaseSize) !== fs.statSync(backupPath).size
  ) {
    errors.push("database size does not match manifest");
  }
  return {
    ok: errors.length === 0,
    backupDir: resolvedDir,
    databasePath: backupPath,
    manifestPath,
    actualSha256,
    integrity: integrity.messages,
    errors,
  };
}

async function restoreBackup({
  dbPath,
  backupDir,
  backupRoot,
  expectedSha256,
  retain = 20,
  now = new Date(),
} = {}) {
  const targetPath = requireExistingFile(dbPath, "target database");
  if (!expectedSha256) {
    throw new Error("Restore requires --expected-sha256");
  }
  const verification = verifyBackup({ backupDir, expectedSha256 });
  if (!verification.ok) {
    throw new Error(`Backup verification failed: ${verification.errors.join("; ")}`);
  }

  const safety = await createBackup({
    dbPath: targetPath,
    backupRoot,
    label: "pre-restore",
    retain,
    now,
    prune: false,
  });
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.restore-${process.pid}-${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.copyFileSync(verification.databasePath, tempPath, fs.constants.COPYFILE_EXCL);
    const tempIntegrity = inspectDatabase(tempPath);
    if (!tempIntegrity.ok || sha256File(tempPath) !== verification.actualSha256) {
      throw new Error("Temporary restored database failed verification");
    }
    replaceFile(tempPath, targetPath);
    const restoredIntegrity = inspectDatabase(targetPath);
    const restoredSha256 = sha256File(targetPath);
    if (!restoredIntegrity.ok || restoredSha256 !== verification.actualSha256) {
      throw new Error("Restored database failed post-restore verification");
    }
    const retention = pruneBackups({
      backupRoot: path.resolve(backupRoot),
      retain,
      protectedDirs: [safety.backupDir, path.resolve(backupDir)],
    });
    return {
      restored: true,
      databasePath: targetPath,
      restoredSha256,
      integrity: "ok",
      preRestoreBackup: safety.backupDir,
      retention,
    };
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

async function runGuardedCommand({
  dbPath,
  backupRoot,
  label,
  retain,
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  now = new Date(),
} = {}) {
  if (!command) {
    throw new Error("Guarded command is required");
  }
  const created = await createBackup({
    dbPath,
    backupRoot,
    label,
    retain,
    now,
  });
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...env,
      MEMORY_V2_BACKUP_DIR: created.backupDir,
      MEMORY_V2_BACKUP_SHA256: created.databaseSha256,
      MEMORY_V2_BACKUP_VERIFIED: "true",
    },
    encoding: "utf8",
    shell: false,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  return { backup: created, status: Number(result.status ?? 1), signal: result.signal };
}

function pruneBackups({
  backupRoot,
  retain = 20,
  protectedDirs = [],
} = {}) {
  const keep = normalizeRetain(retain);
  const protectedSet = new Set(protectedDirs.map((item) => path.resolve(item)));
  const dirs = listBackupDirs(backupRoot);
  const removable = dirs.slice(0, Math.max(0, dirs.length - keep))
    .filter((item) => !protectedSet.has(item));
  for (const item of removable) {
    fs.rmSync(item, { recursive: true, force: false });
  }
  return {
    retained: listBackupDirs(backupRoot).length,
    removed: removable,
  };
}

function listBackupDirs(backupRoot) {
  const root = path.resolve(String(backupRoot || ""));
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(BACKUP_PREFIX))
    .filter((entry) => !entry.name.includes(".staging-"))
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function inspectDatabase(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    return readIntegrity(db);
  } finally {
    db.close();
  }
}

function readIntegrity(db) {
  const messages = db.prepare("PRAGMA integrity_check").all()
    .map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? ""));
  return { ok: messages.length === 1 && messages[0] === "ok", messages };
}

function replaceFile(tempPath, targetPath) {
  try {
    fs.renameSync(tempPath, targetPath);
    return;
  } catch (error) {
    if (!["EEXIST", "EPERM", "EACCES"].includes(error.code)) {
      throw error;
    }
  }
  const displaced = `${targetPath}.displaced-${process.pid}-${crypto.randomUUID()}`;
  fs.renameSync(targetPath, displaced);
  try {
    fs.renameSync(tempPath, targetPath);
    fs.rmSync(displaced, { force: true });
  } catch (error) {
    if (!fs.existsSync(targetPath) && fs.existsSync(displaced)) {
      fs.renameSync(displaced, targetPath);
    }
    throw error;
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function requireExistingFile(value, label) {
  const resolved = path.resolve(String(value || ""));
  if (!value || !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  return resolved;
}

function formatTimestamp(value) {
  return normalizeDate(value).toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return date;
}

function normalizeRetain(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error(`retain must be between 1 and 1000: ${value}`);
  }
  return parsed;
}

function sanitizeLabel(value) {
  const label = String(value || "write").trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return label || "write";
}

function normalizeSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    throw new Error("Expected SHA256 must contain exactly 64 hexadecimal characters");
  }
  return sha;
}

function parseOptions(argv) {
  const options = { commandArgs: [] };
  let commandMode = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (commandMode) {
      options.commandArgs.push(value);
    } else if (value === "--") {
      commandMode = true;
      options.command = argv[index + 1];
      index += 1;
    } else if (value.startsWith("--")) {
      const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return options;
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  const options = parseOptions(argv);
  if (subcommand === "create") {
    const result = await createBackup({
      dbPath: options.db,
      backupRoot: options.backupRoot,
      label: options.label,
      retain: options.retain ?? 20,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (subcommand === "verify") {
    const result = verifyBackup({
      backupDir: options.backup,
      expectedSha256: options.expectedSha256,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 2;
    return;
  }
  if (subcommand === "restore") {
    const result = await restoreBackup({
      dbPath: options.db,
      backupDir: options.backup,
      backupRoot: options.backupRoot,
      expectedSha256: options.expectedSha256,
      retain: options.retain ?? 20,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (subcommand === "guard") {
    const result = await runGuardedCommand({
      dbPath: options.db,
      backupRoot: options.backupRoot,
      label: options.label,
      retain: options.retain ?? 20,
      command: options.command,
      args: options.commandArgs,
    });
    process.exitCode = result.status;
    return;
  }
  throw new Error(
    "Usage:\n"
    + "  memory-v2-backup.js create --db FILE --backup-root DIR [--label NAME] [--retain N]\n"
    + "  memory-v2-backup.js verify --backup DIR [--expected-sha256 SHA]\n"
    + "  memory-v2-backup.js restore --db FILE --backup DIR --backup-root DIR "
    + "--expected-sha256 SHA [--retain N]\n"
    + "  memory-v2-backup.js guard --db FILE --backup-root DIR [--label NAME] "
    + "[--retain N] -- COMMAND [ARGS...]",
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[memory-v2-backup] ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createBackup,
  listBackupDirs,
  pruneBackups,
  restoreBackup,
  runGuardedCommand,
  verifyBackup,
};
