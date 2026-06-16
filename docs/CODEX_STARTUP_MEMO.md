# Codex Startup Memo

This is the fixed startup memo for continuing Memory V2 or CyberBoss work.

When the user says "继续 memory-v2 工作", "继续 CyberBoss 工作", or simply
"继续工作", read this file before taking project actions.

## Current Memory V2 State

- The Memory V2 audit and supplemental cleanup are complete and accepted.
- The focused maintenance suite passed `14/14` tests.
- Health check, backup and rollback, recall/heat design, and night-maintenance
  dry-run have been delivered.
- The completed work did not modify the production database, L0, the main chat
  path, or PM2, and did not perform a schema migration.
- The maintenance toolkit has been deployed to `/root/cyberboss-main`.
- The first production read-only report passed:
  `/root/.cyberboss/inbox/memory-v2/maintenance-reports/memory-v2-maintenance-20260615T075234Z`.
- Recall/heat migration and five recall samples passed on a verified backup
  copy only. Read `docs/memory-v2-preproduction-validation-2026-06-15.md`.
- The minimal additive recall/heat schema migration has now completed on the
  production database. Read
  `docs/memory-v2-production-schema-migration-2026-06-15.md`.
- Production has `last_recalled_at`, `recall_count`,
  `memory_recall_audit`, and `idx_memory_recall_audit_memory_time`.
- No recall writer or chat call-path integration is enabled.
- Do not repeat the old full-library audit unless the user explicitly requests
  a new audit with a new scope.

## Core Entry Files

Read these as the primary handoff chain:

1. `memory-v2-final-audit-summary.md`
2. `docs/memory-v2-next-work-guide.md`
3. `scripts/memory-v2-maintenance.js`

Additional detailed references:

- `docs/memory-v2-backup-and-rollback.md`
- `docs/memory-v2-recall-heat-design.md`
- `docs/memory-v2-night-maintenance-dry-run.md`
- `docs/memory-v2-claude-throttled-rollout.md`
- `docs/memory-v2-preproduction-validation-2026-06-15.md`
- `docs/memory-v2-production-schema-migration-2026-06-15.md`

The production VPS database remains authoritative. Local files are
implementation and handoff artifacts until deliberately deployed.

## Required Startup Procedure

Before continuing Memory V2 or related CyberBoss maintenance:

1. Read `docs/CODEX_STARTUP_MEMO.md`.
2. Read `docs/memory-v2-next-work-guide.md`.
3. Inspect the current capability and working-tree version of
   `scripts/memory-v2-maintenance.js`.
4. Classify the requested task as one of:
   - read-only inspection
   - dry-run
   - design
   - database write
   - schema migration
   - PM2 or main-process operation
5. If the task is high risk, stop before execution, explain the reason, risk,
   evidence required, backup state, and rollback plan, then wait for user
   confirmation.

Do not infer permission for a high-risk operation from a general request to
"continue".

## High-Risk Red Lines

- Never delete or rewrite the L0 source layer.
- Never write the database without a verified backup.
- Never perform bulk database changes without a dry-run.
- Never perform a schema migration without explicit approval.
- Never restart PM2 or the CyberBoss main process without explicit approval.
- Never rerun a full-library Claude audit by default.
- Never use Opus for bulk mechanical classification.
- Never treat system triggers, skill injections, tool logs, or refusal
  boilerplate as real user memory.
- Never bulk-change `active`, `invalid`, or `pending` states without a reviewed
  proposal, backup, transaction, audit evidence, and explicit approval.
- Never treat a dry-run report as permission to apply its proposals.

## Claude Usage Throttling

- Default to Codex, DeepSeek, deterministic local scripts, and structured
  checks for implementation, maintenance, counting, validation, and reports.
- Use Claude only for high-risk final review, a small number of difficult
  semantic judgments, or an important architecture decision.
- Any Claude invocation expected to use substantial tokens or take more than
  10 minutes must first be justified to the user and must wait for explicit
  confirmation.
- Claude must not do bulk review, routine counting, backup work, migration
  mechanics, or repetitive classification.
- Codex owns tool evidence, schema checks, backups, hashes, transactions,
  tests, deployment safety, and rollback verification.

## Next-Stage Direction

- Do not repeat the completed old-library audit.
- Keep `scripts/memory-v2-maintenance.js` stable as the unified read-only
  maintenance entry point.
- Continue strengthening health check, backup, rollback, and night-maintenance
  dry-run behavior before adding automatic writes.
- Use the smallest recall/heat release:
  - reuse existing `heat` and `pinned`
  - add only the minimum recall fields and idempotent recall audit support
  - rehearse migration on a disposable copy of a verified backup
- Before any production recall/heat write:
  - create and verify a backup
  - complete a disposable-copy dry-run
  - test a sample of only 3 to 5 noncritical memories
  - confirm L0 hashes do not change
  - confirm PM2 restart is unnecessary
- Night maintenance remains dry-run-only. Automatic database writes require a
  separate design, backup, review, and explicit approval.

## Current Safe Commands

After the scripts are deliberately deployed to `/root/cyberboss-main`, the
routine read-only entry is:

```bash
node scripts/memory-v2-maintenance.js \
  --db /root/.cyberboss/memory-v2.sqlite \
  --output-root /root/.cyberboss/inbox/memory-v2/maintenance-reports
```

Read-only components:

- `scripts/memory-v2-health-check.js`
- `scripts/memory-v2-night-maintenance-dry-run.js`
- `scripts/memory-v2-maintenance.js`

Backup creation is allowed only as an explicit maintenance action. Restore is
a database write and requires confirmation.

## Current Stop Point

Memory V2 production schema is recall/heat-ready. The current boundary is
implementation and approval of the actual recall writer.

The following have not been approved or executed:

- production recall/heat writes
- automatic night-maintenance writes
- backup restore
- PM2 restart
- L0 changes
- bulk status changes
- full-library Claude or Opus review
