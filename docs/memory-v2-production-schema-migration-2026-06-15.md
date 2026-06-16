# Memory V2 Production Schema Migration

Date: 2026-06-15
Scope: minimal additive recall/heat schema only

## Result

Production migration completed successfully.

- Production database:
  `/root/.cyberboss/memory-v2.sqlite`
- Migration report:
  `/root/.cyberboss/inbox/memory-v2/migrations/recall-heat-20260615T080848Z/migration.json`
- Post-migration health JSON:
  `/root/.cyberboss/inbox/memory-v2/migrations/recall-heat-20260615T080848Z/health/post-migration-health.json`
- Post-migration health Markdown:
  `/root/.cyberboss/inbox/memory-v2/migrations/recall-heat-20260615T080848Z/health/post-migration-health.md`

The recall writer was not deployed or enabled.

## Pre-Migration Backup

Backup directory:

`/root/.cyberboss/inbox/memory-v2/backups/memory-v2-20260615T080848Z-pre-recall-heat-production-migration`

Backup database SHA256:

`10ccfc3eb5af159a75016762921ace5c60f0772efa5342b6f78c51151eaa1cf4`

The backup passed:

- manifest validation
- size validation
- exact SHA256 verification
- SQLite integrity check

## Database Hashes

- Before migration:
  `ddda26203d9fa520f80198d6a9845fb26dc6ad9ab11a46f35eed5b6e03a768c5`
- After migration:
  `ac69ffea3a3173d6603257f741d393d53a7e6214566662ad8e00cf8769b24a6e`

The hash change is expected because the production schema changed.

## Applied Migration

Only the previously rehearsed additive migration was applied:

```sql
ALTER TABLE memory_index ADD COLUMN last_recalled_at TEXT;
ALTER TABLE memory_index ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
```

Added table:

`memory_recall_audit`

Added index:

`idx_memory_recall_audit_memory_time`

No field or table was removed.

## Field Verification

- `last_recalled_at`: `TEXT`, nullable
- `recall_count`: `INTEGER NOT NULL DEFAULT 0`
- existing `heat`: unchanged
- existing `pinned`: unchanged
- existing `last_recalled`: retained

Backfill:

- valid legacy `last_recalled` timestamps: 1
- copied into `last_recalled_at`: 1
- nonzero default `recall_count` rows: 0
- initial `memory_recall_audit` rows: 0

No recall event was written during migration.

## Data Verification

Counts before and after:

- active: 1,364
- invalid: 2,246
- pending: 196

Unchanged:

- status counts
- content digest
- source digest
- review audit count

Post-migration health:

- healthy: true
- integrity: `ok`
- explicit skip: 196
- pinned: 44
- review audit rows: 3,806
- critical health findings: 0

## Safety Verification

- L0 aggregate SHA256 before:
  `3cd28ff2299fa2cdcfeb42029157bbc38f5c6be07baedc057ac075f0ae99282d`
- L0 aggregate SHA256 after:
  `3cd28ff2299fa2cdcfeb42029157bbc38f5c6be07baedc057ac075f0ae99282d`
- L0 modified: no
- PM2 restarted: no
- PM2 PID before and after: `1352458`
- main chat path changed: no
- recall writer enabled: no
- night automatic writer enabled: no

## Rollback

Application rollback is not needed because no recall writer is active.

If schema rollback becomes necessary:

1. Stop all Memory V2 writers.
2. Verify the pre-migration backup SHA256:
   `10ccfc3eb5af159a75016762921ace5c60f0772efa5342b6f78c51151eaa1cf4`.
3. Run `scripts/memory-v2-backup.js restore`.
4. Allow the restore tool to create a pre-restore backup.
5. Run integrity and health checks.
6. Confirm L0 and PM2 remain unchanged.

Restore replaces the database and is a separate high-risk operation requiring
explicit user approval.

Do not attempt to remove the additive columns by rebuilding the table as an
informal rollback.

## Current Stop Point

Production is schema-ready for a future recall writer.

The following remain unapproved and inactive:

- production recall writes
- chat call-path integration
- PM2 restart
- night automatic writes
- decay application
- backup restore
