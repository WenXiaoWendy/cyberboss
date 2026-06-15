# Memory V2 Claude-Throttled Rollout

Status: design and operating commands only
Production database changed: no
Production schema migrated: no
Claude bulk review used: no

## Current State

- The completed audit baseline is `active 1364 / invalid 2246 / pending 196`.
- All pending rows are explicit skip decisions.
- The old library does not need another full audit.
- Health check and night maintenance are read-only.
- Backup creation is a controlled write to the backup directory, not to the
  production database.
- Restore, schema migration, recall heat updates, and status changes are
  database writes and require an explicit stop and approval.
- The maintenance tools currently exist in the local working tree. Production
  VPS commands below become executable only after these files are deliberately
  deployed to `/root/cyberboss-main`.

## Verified Read-Only Behavior

Focused verification on 2026-06-15:

- health check tests: passed
- unified maintenance test: passed
- night dry-run tests: passed
- database SHA256 remained unchanged in read-only test fixtures
- backup and rollback tests: passed using temporary SQLite databases

No production database, L0, main chat path, schema, or PM2 process was changed.

## Commands

Run these from `/root/cyberboss-main` after the scripts are deployed there.

### Health Check

```bash
node scripts/memory-v2-health-check.js \
  --db /root/.cyberboss/memory-v2.sqlite \
  --output-dir /root/.cyberboss/inbox/memory-v2/health-reports
```

This opens SQLite read-only and produces JSON and Markdown reports.

### Unified Maintenance Report

```bash
node scripts/memory-v2-maintenance.js \
  --db /root/.cyberboss/memory-v2.sqlite \
  --output-root /root/.cyberboss/inbox/memory-v2/maintenance-reports
```

This runs the health check and night dry-run together. It writes only report
files.

### Night Maintenance Dry Run

```bash
node scripts/memory-v2-night-maintenance-dry-run.js \
  --db /root/.cyberboss/memory-v2.sqlite \
  --output-dir /root/.cyberboss/inbox/memory-v2/night-reports \
  --soften-heat 0.2 \
  --soften-age-days 90 \
  --max-insights 5
```

This proposes actions but does not soften, merge, delete, insert, or change a
status.

### Create And Verify A Backup

```bash
node scripts/memory-v2-backup.js create \
  --db /root/.cyberboss/memory-v2.sqlite \
  --backup-root /root/.cyberboss/inbox/memory-v2/backups \
  --label pre-recall-heat \
  --retain 20
```

This creates a timestamped online SQLite backup, `manifest.json`, and
`SHA256SUMS`. It does not change rows in the production database.

### View Rollback Instructions

```bash
sed -n '1,220p' docs/memory-v2-backup-and-rollback.md
```

On the current Windows working tree:

```powershell
Get-Content docs\memory-v2-backup-and-rollback.md
```

Do not run the `restore` subcommand merely to test it against production.
Restore is a database write and requires explicit maintenance approval.

## Minimal Recall/Heat Release

### Existing Fields To Reuse

- `heat REAL`, already constrained to `0.05..3.0`
- `pinned INTEGER`, already constrained to `0|1`
- legacy `last_recalled`
- `updated_at`

### Minimum Additive Fields

```sql
ALTER TABLE memory_index ADD COLUMN last_recalled_at TEXT;
ALTER TABLE memory_index ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
```

Add an idempotency and provenance table:

```sql
CREATE TABLE memory_recall_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  memory_id TEXT NOT NULL,
  recalled_at TEXT NOT NULL,
  consumer TEXT NOT NULL,
  purpose TEXT NOT NULL,
  source_turn_id TEXT,
  heat_before REAL NOT NULL,
  heat_after REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memory_index(id)
);

CREATE INDEX idx_memory_recall_audit_memory_time
  ON memory_recall_audit(memory_id, recalled_at);
```

`last_decayed_at`, `softened_at`, and `softening_reason` are deferred. They are
not needed to prove the first recall path.

### Is A Schema Migration Required?

Yes. It is a small additive migration, but it is still a production schema
change and therefore a high-risk stop point. The first execution must happen
only on a disposable copy of a verified backup.

### Recall Transaction

Only actual content consumption calls `recall`. Search, list, metadata, review,
health check, and night dry-run remain read-only.

Required input:

```js
{
  eventId,
  memoryId,
  consumer,
  purpose,
  sourceTurnId
}
```

One transaction must:

1. Verify that the memory may be recalled.
2. Insert the unique `event_id` audit row.
3. If the event already exists, return without a second heat increment.
4. Atomically update:

```sql
UPDATE memory_index
SET heat = MIN(3.0, MAX(0.05, heat) + 0.3),
    last_recalled_at = :now,
    last_recalled = :now,
    recall_count = recall_count + 1,
    updated_at = :now
WHERE id = :memory_id;
```

5. Store `heat_before` and `heat_after` in the audit row.
6. Commit and return the body.

The update uses the database value of `heat`, avoiding lost increments from
concurrent recalls.

### Pinned Decay Immunity

The first release does not apply decay. Its dry-run query must contain:

```sql
WHERE status = 'active'
  AND pinned = 0
```

Any proposal containing a pinned memory is a failed dry-run. Pinning does not
set heat to `3.0`; it only prevents decay.

## Disposable-Copy Dry Run

The first migration rehearsal must:

1. Run the current read-only health check.
2. Create and verify a fresh online backup.
3. Copy the verified backup to a disposable path.
4. Record production and L0 hashes.
5. Apply the additive migration only to the disposable database.
6. Backfill valid `last_recalled_at = last_recalled`.
7. Leave `recall_count = 0`; do not infer counts from historical heat.
8. Select 3 to 5 active, unpinned test memories from the disposable copy.
9. Verify one recall raises heat by exactly `0.3`.
10. Verify a repeated `event_id` does not raise heat twice.
11. Verify heat caps at `3.0`.
12. Verify search and metadata access do not change heat.
13. Verify pinned memories never appear in decay proposals.
14. Run integrity and health checks.
15. Compare row counts, statuses, content, sources, and L0 hashes.
16. Delete only the disposable test copy after preserving the report.

The dry run must not use production recall traffic.

## Rollback

Because the migration is additive, the preferred first rollback is application
rollback:

1. Disable the new recall writer.
2. Return to code that reads legacy `last_recalled`.
3. Leave the additive columns and audit table in place.
4. Run health checks.

Do not rebuild the SQLite table merely to remove two unused columns.

If database restoration is necessary:

1. Stop Memory V2 writers.
2. Verify the selected backup SHA256.
3. Use `memory-v2-backup.js restore`.
4. Allow it to create a pre-restore backup.
5. Run integrity and health checks.
6. Verify L0 hashes and PM2 state remain unchanged.

Restore itself requires explicit approval.

## Claude Throttling Rule

Claude is not part of health checks, migrations, backups, counting, duplicate
grouping, or batch review.

Claude may be used only for:

- a very small final semantic review of ambiguous recall behavior
- final wording or interpretation of a handful of INSIGHT candidates
- a high-impact conflict that deterministic checks cannot resolve

Codex owns schema checks, scripts, backups, hashes, transactions, tests, and
rollback evidence.

## Pre-Production Checklist

- [ ] No full-library audit is scheduled.
- [ ] Current health check passes or every failure is explicitly understood.
- [ ] A fresh timestamped backup exists.
- [ ] Backup integrity, size, and SHA256 are verified.
- [ ] Disposable-copy migration dry-run passes.
- [ ] Old-schema and additive-schema compatibility tests pass.
- [ ] Test sample is limited to 3 to 5 noncritical active memories.
- [ ] Search and directory browsing remain heat-neutral.
- [ ] Recall increases heat exactly `0.3` and caps at `3.0`.
- [ ] Duplicate `event_id` is idempotent.
- [ ] `last_recalled_at` uses the real UTC consumption time.
- [ ] `recall_count` starts at zero and is not inferred from old heat.
- [ ] Pinned memories are excluded from all decay proposals.
- [ ] No active, invalid, or pending states are changed by migration.
- [ ] L0 hashes are captured before and after and remain identical.
- [ ] Main chat path is not connected during the rehearsal.
- [ ] PM2 restart is not required by the planned procedure.
- [ ] If a restart becomes necessary, stop and provide risk and rollback first.
- [ ] Claude is reserved for small final review only.
- [ ] Production migration has separate explicit approval.
- [ ] Production write is run behind the backup guard.
- [ ] Post-write integrity, health, counts, and audit reconciliation are ready.

## Current Stop Point

The system is ready for a disposable-copy recall/heat migration rehearsal.
Production migration, production recall writes, restore, PM2 restart, L0
changes, and bulk status changes remain unapproved and have not been run.
