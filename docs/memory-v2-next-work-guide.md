# Memory V2 Next Work Guide

## Current Baseline

The completed audit baseline is recorded in:

- `memory-v2-final-audit-summary.md`

Final reviewed database state:

- active: 1,364
- invalid: 2,246
- pending: 196
- explicit skip: 196
- audit rows: 3,806

All 3,806 records are covered by batches `002` through `192`. The remaining
pending records are intentional skip decisions.

## Routine Read-Only Maintenance

Use the unified entry point:

```bash
node scripts/memory-v2-maintenance.js \
  --db /root/.cyberboss/memory-v2.sqlite \
  --output-root /root/.cyberboss/inbox/memory-v2/maintenance-reports
```

Each run creates a timestamped directory containing:

- `manifest.json`
- `summary.md`
- `health.json`
- `health.md`
- `night-dry-run.json`
- `night-dry-run.md`

This routine is read-only. It does not require a backup, modify L0, or restart
PM2.

Recommended cadence:

- nightly: unified read-only maintenance
- weekly: review summary trends and unsupported checks
- before any write: health check, verified backup, candidate revalidation
- after any write: integrity check, health check, count reconciliation

## Health Check Only

```bash
node scripts/memory-v2-health-check.js \
  --db /root/.cyberboss/memory-v2.sqlite \
  --output-dir /root/.cyberboss/inbox/memory-v2/health-reports
```

A nonzero exit code means a critical check failed. Read the JSON samples before
planning a repair. Do not automatically convert findings into status changes.

## Night Dry Run Only

```bash
node scripts/memory-v2-night-maintenance-dry-run.js \
  --db /root/.cyberboss/memory-v2.sqlite \
  --output-dir /root/.cyberboss/inbox/memory-v2/night-reports \
  --soften-heat 0.2 \
  --soften-age-days 90 \
  --max-insights 5
```

Unsupported graph or structured-fact checks are expected until those schema
features exist. Unsupported does not mean healthy or empty.

## Before Any Database Write

Run the writer through:

```bash
node scripts/memory-v2-backup.js guard \
  --db /root/.cyberboss/memory-v2.sqlite \
  --backup-root /root/.cyberboss/inbox/memory-v2/backups \
  --label CHANGE_NAME \
  --retain 20 \
  -- COMMAND ARGUMENTS
```

The writer must not start unless the backup is complete, integrity-checked,
hashed, published, and reverified.

Read the complete procedure:

- `docs/memory-v2-backup-and-rollback.md`

## Recall And Heat Next Step

The design is ready but not deployed:

- `docs/memory-v2-recall-heat-design.md`

The next implementation task is a disposable-copy migration dry run. Do not
apply the schema additions directly to production.

Required sequence:

1. Read-only schema and data preflight.
2. Fresh verified online backup.
3. Apply additive migration to a disposable backup copy.
4. Test old-schema and new-schema compatibility.
5. Produce schema diff, row counts, integrity result, and L0 hash comparison.
6. Stop for explicit approval before production migration.

## Night Proposal Apply Boundary

The current night tool proposes but never applies:

- softening
- edge cleanup
- duplicate merges
- conflict resolution
- INSIGHT insertion

Any apply implementation must:

1. Require an immutable proposal report ID.
2. Recheck every candidate against current database state.
3. Reject pinned invalidation or deletion.
4. Run behind the backup guard.
5. Use one transaction.
6. Add an audit row for every mutation.
7. Preserve `source_ids` for every INSIGHT.
8. Run post-apply integrity and health checks.

Bulk application requires explicit approval.

## Hard Stop Conditions

Stop and ask before:

- deleting data
- changing L0
- applying a schema migration to production
- restarting PM2 or CyberBoss
- bulk-changing active or invalid states
- inserting or applying a large INSIGHT set
- restoring a backup
- performing any write without a verified backup

Do not treat system triggers, skill documents, tool logs, or refusal boilerplate
as user memory.

## Incident Recovery

If a health check fails:

1. Preserve the report directory.
2. Do not run an automatic repair.
3. Confirm whether the problem is data, schema, or unsupported analysis.
4. Create a fresh verified backup before any repair.
5. Make the smallest transactional change.
6. Run health and integrity checks again.

If rollback is required, use the exact expected SHA256 and let the restore tool
create a pre-restore backup first.

## Production Boundaries

- L0 remains append-only.
- Memory V2 maintenance does not modify the main chat path.
- PM2 restart is not part of routine maintenance.
- A report is evidence, not permission to apply its proposals.
- The VPS database is authoritative; local files are implementation and
  handoff artifacts until deliberately deployed.

## Delivered Files

- `memory-v2-final-audit-summary.md`
- `scripts/memory-v2-health-check.js`
- `scripts/memory-v2-backup.js`
- `docs/memory-v2-backup-and-rollback.md`
- `docs/memory-v2-recall-heat-design.md`
- `scripts/memory-v2-night-maintenance-dry-run.js`
- `docs/memory-v2-night-maintenance-dry-run.md`
- `scripts/memory-v2-maintenance.js`
- `docs/memory-v2-next-work-guide.md`

Associated focused tests live under `test/memory-v2-*.test.js`.
