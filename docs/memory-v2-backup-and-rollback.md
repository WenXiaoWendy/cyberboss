# Memory V2 Backup And Rollback

## Safety Contract

Every Memory V2 database writer must run through the backup guard. The guard
does not start the writer until all of the following are true:

1. The source SQLite database passes `PRAGMA integrity_check`.
2. SQLite's online backup API has produced a consistent snapshot, including
   data that may still be in WAL.
3. The snapshot passes its own integrity check.
4. Its size and SHA256 are recorded in `manifest.json`.
5. The published backup passes an independent verification.

The guard exports these variables to the child writer:

- `MEMORY_V2_BACKUP_VERIFIED=true`
- `MEMORY_V2_BACKUP_DIR`
- `MEMORY_V2_BACKUP_SHA256`

New write scripts should refuse to run unless
`MEMORY_V2_BACKUP_VERIFIED=true`. Existing scripts should be invoked only
through the guard until that check is added to them.

## Create A Backup

```bash
node scripts/memory-v2-backup.js create \
  --db /root/.cyberboss/memory-v2.sqlite \
  --backup-root /root/.cyberboss/inbox/memory-v2/backups \
  --label manual \
  --retain 20
```

The output directory is named:

`memory-v2-YYYYMMDDTHHMMSSZ-LABEL`

Each completed directory contains:

- `memory-v2.sqlite`
- `manifest.json`
- `SHA256SUMS`

Staging directories are never treated as valid backups.

## Guard A Database Write

Put the write command after `--`. Arguments are passed directly without a
shell:

```bash
node scripts/memory-v2-backup.js guard \
  --db /root/.cyberboss/memory-v2.sqlite \
  --backup-root /root/.cyberboss/inbox/memory-v2/backups \
  --label review-apply \
  --retain 20 \
  -- node /root/.cyberboss/inbox/memory-v2/memory-v2-apply-opus-decisions.js \
  /root/.cyberboss/memory-v2.sqlite \
  /root/.cyberboss/inbox/memory-v2 \
  /root/.cyberboss/inbox/memory-v2/backups/apply-specific \
  193
```

If backup creation or verification fails, the writer is never started.

## Verify A Backup

```bash
node scripts/memory-v2-backup.js verify \
  --backup /root/.cyberboss/inbox/memory-v2/backups/memory-v2-TIMESTAMP-LABEL
```

For rollback, pin the exact expected digest:

```bash
node scripts/memory-v2-backup.js verify \
  --backup /root/.cyberboss/inbox/memory-v2/backups/memory-v2-TIMESTAMP-LABEL \
  --expected-sha256 64_HEX_CHARACTERS
```

## Retention

`--retain N` keeps the newest `N` completed `memory-v2-*` backup directories.
Pruning runs only after the new backup is published and reverified. The backup
created by the current operation is protected from pruning.

For production, start with `N=20`. Do not point the backup root at a directory
containing unrelated artifacts.

## Rollback

Rollback is an explicit maintenance operation. It does not touch L0 and does
not restart PM2.

1. Stop or otherwise exclude concurrent Memory V2 writers.
2. Read the selected backup's SHA256 from its manifest.
3. Verify the selected backup independently.
4. Run restore with that exact SHA256.
5. The restore command first creates a `pre-restore` backup of the current
   database.
6. The restored database is checked for integrity and exact hash equality.
7. Run the read-only health check after restoration.

```bash
node scripts/memory-v2-backup.js restore \
  --db /root/.cyberboss/memory-v2.sqlite \
  --backup /root/.cyberboss/inbox/memory-v2/backups/memory-v2-TIMESTAMP-LABEL \
  --backup-root /root/.cyberboss/inbox/memory-v2/backups \
  --expected-sha256 64_HEX_CHARACTERS \
  --retain 20

node scripts/memory-v2-health-check.js \
  --db /root/.cyberboss/memory-v2.sqlite \
  --output-dir /root/.cyberboss/inbox/memory-v2/health-reports
```

If post-restore validation fails, use the reported `preRestoreBackup` directory
as the source for a second restore. Do not modify L0 as part of rollback.

## Operational Boundary

- Backup and verification are allowed without restarting CyberBoss.
- Restore writes the database and should be performed only with explicit
  maintenance authorization.
- This tool never modifies L0.
- This tool never changes PM2.
- Schema migrations and bulk state changes still require their own dry-run and
  approval even when protected by a backup.
