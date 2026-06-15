# Memory V2 Preproduction Validation

Date: 2026-06-15
Scope: VPS read-only maintenance and backup-copy recall/heat rehearsal

## Local Commits

- `3f59b44 Add Memory V2 maintenance toolkit`
- `474aad3 Add recall heat rehearsal tool`

The commits contain only Memory V2 documentation, scripts, tests, startup
handoff files, and the final audit report. They do not contain credentials,
database files, private logs, or backup payloads.

## VPS Deployment

Deployed to:

`/root/cyberboss-main`

Deployed components:

- startup and handoff documentation
- health check
- unified maintenance report runner
- online backup and rollback tool
- night-maintenance dry-run
- recall/heat backup-copy rehearsal
- focused tests

No PM2 restart was performed. No production schema or application call path
was changed.

## First Production Read-Only Report

Report directory:

`/root/.cyberboss/inbox/memory-v2/maintenance-reports/memory-v2-maintenance-20260615T075234Z`

Files:

- `summary.md`
- `manifest.json`
- `health.json`
- `health.md`
- `night-dry-run.json`
- `night-dry-run.md`

Result:

- health: PASS
- active: 1,364
- invalid: 2,246
- pending: 196
- explicit skip: 196
- softening proposals: 0
- duplicate proposals: 0
- insight proposals: 0
- graph-edge analysis: unsupported by current schema
- structured fact-conflict analysis: unsupported by current schema

Production database verification before and after the report:

- SHA256:
  `ddda26203d9fa520f80198d6a9845fb26dc6ad9ab11a46f35eed5b6e03a768c5`
- size: `6,569,984` bytes
- modification timestamp: unchanged
- PM2 PID: `1352458` before and after

Only report files were written.

## Rehearsal Backup

Backup directory:

`/root/.cyberboss/inbox/memory-v2/backups/memory-v2-20260615T075335Z-pre-recall-heat-rehearsal`

Backup database SHA256:

`10ccfc3eb5af159a75016762921ace5c60f0772efa5342b6f78c51151eaa1cf4`

Verification:

- manifest present
- size present
- SHA256 match
- SQLite integrity: `ok`
- production database unchanged

## Recall/Heat Migration Rehearsal

Rehearsal directory:

`/root/.cyberboss/inbox/memory-v2/rehearsals/recall-heat-20260615T075335Z`

Reports:

- `recall-heat-rehearsal.json`
- `recall-heat-rehearsal.md`
- `post-migration-health/post-migration-health.json`
- `post-migration-health/post-migration-health.md`

The migration was applied only to:

`memory-v2-rehearsal.sqlite`

Migration result:

- added `last_recalled_at TEXT`
- added `recall_count INTEGER NOT NULL DEFAULT 0`
- created `memory_recall_audit`
- created `idx_memory_recall_audit_memory_time`
- copied 1 valid legacy `last_recalled` timestamp
- all initial `recall_count` values remained zero
- row counts unchanged
- content digest unchanged
- source digest unchanged
- post-migration health: PASS
- integrity: `ok`

The production database and source backup SHA256 values remained unchanged.

## Five Recall Samples

All five samples passed:

| Sample | Heat before | Heat after | Delta | Recall count |
| --- | ---: | ---: | ---: | ---: |
| 1 | 0.05 | 0.35 | +0.30 | 0 to 1 |
| 2 | 0.05 | 0.35 | +0.30 | 0 to 1 |
| 3 | 0.05 | 0.35 | +0.30 | 0 to 1 |
| 4 | 0.05 | 0.35 | +0.30 | 0 to 1 |
| 5 | 0.05 | 0.35 | +0.30 | 0 to 1 |

Additional checks:

- each `last_recalled_at` recorded the rehearsal UTC time
- directory reads did not change heat or recall count
- repeating the first `event_id` was idempotent
- the repeated event did not increase heat again
- 43 low-heat pinned controls were excluded from decay candidates
- no active, invalid, or pending status changed

## Pinned State

Production read-only count:

- active pinned: 43
- pending pinned: 1
- invalid pinned: 0

This explains why the health report contains 44 pinned rows while the original
review recorded 43 pin decisions.

## Rollback

No production rollback is needed because production was not migrated.

For the rehearsal:

1. Preserve the JSON and Markdown reports.
2. Remove only the rehearsal SQLite file when cleanup is desired.
3. Keep the verified source backup.

For a future production migration:

1. Disable the new recall writer.
2. Prefer application rollback that ignores additive fields.
3. If database restore is required, verify the exact backup SHA256.
4. Use `scripts/memory-v2-backup.js restore`.
5. Allow creation of a pre-restore backup.
6. Run integrity and health checks.
7. Confirm L0 and PM2 remain unchanged.

Database restoration remains a high-risk operation requiring explicit
approval.

## Production Launch Checklist

- [x] Maintenance toolkit committed locally.
- [x] Toolkit deployed to the VPS project directory.
- [x] First production read-only health report passed.
- [x] Night maintenance dry-run produced reports without database writes.
- [x] Fresh online backup created and verified.
- [x] Migration rehearsed only on a backup copy.
- [x] New fields, defaults, audit table, and index verified.
- [x] Five recall samples increased heat by exactly `0.3`.
- [x] `last_recalled_at` and `recall_count` verified.
- [x] Directory reads remained heat-neutral.
- [x] Duplicate recall event was idempotent.
- [x] Pinned memories were excluded from decay proposals.
- [x] Production database SHA256, size, and modification time remained unchanged.
- [x] L0 was not modified.
- [x] PM2 was not restarted.
- [x] Actual chat call path was not connected.
- [x] Claude was not used for bulk judgment.
- [ ] Obtain explicit approval for production schema migration.
- [ ] Create a new verified backup immediately before production migration.
- [ ] Apply the additive migration transactionally to production.
- [ ] Deploy and enable the actual recall writer.
- [ ] Run post-migration health, integrity, and count reconciliation.
- [ ] Observe recall audit and heat behavior before enabling any decay writer.

## Current Stop Point

Safe preproduction validation is complete.

Production still requires an additive schema migration and actual recall-writer
integration. Both are write operations and require explicit user confirmation.
No PM2 restart is currently proven necessary.
