# Memory V2.5 Shadow Upgrade Plan

Status: design only. No production code, DB, L0, PM2, env, or runtime changes are part of this document.

Date: 2026-06-30
Target system: CyberBoss Memory V2 on VPS /root/cyberboss-main
Reference: github.com/wuxuyun0606-collab/lmc-5

## Hard Boundaries

This V2.5 plan is intentionally a shadow upgrade. It must not replace Memory V2, migrate to LMC-5, attach PostgreSQL/pgvector, or enable any new automatic writes.

Non-negotiable boundaries:

- Do not modify production runtime behavior in Phase 0.
- Do not write production Memory V2 DB except in an explicitly approved later controlled write phase.
- Do not modify L0 conversation originals.
- Do not start new recurring write jobs.
- Do not enable night_dream apply.
- Do not automatically supersede facts.
- Do not automatically write relation edges.
- Do not affect live WeChat replies.

## Sources Reviewed

CyberBoss current state, read-only:

- /root/cyberboss-main/src/memory-v2/schema.js
- /root/cyberboss-main/src/memory-v2/store.js
- /root/cyberboss-main/src/memory-v2/candidate-extractor.js
- /root/cyberboss-main/src/memory-v2/retrieval.js
- /root/cyberboss-main/src/memory-v2/recall-writer.js
- /root/cyberboss-main/scripts/memory-v2-claude-candidate-dry-run.js
- /root/cyberboss-main/scripts/run-memory-v2-claude-candidate-dry-run.sh
- /root/cyberboss-main/scripts/memory-v2-night-maintenance-dry-run.js
- /root/cyberboss-main/scripts/memory-v2-maintenance.js
- /root/cyberboss-main/scripts/memory-v2-backup.js
- /root/cyberboss-main/scripts/memory-v2-health-check.js
- /root/.cyberboss/memory-v2.sqlite, read-only metadata only
- /root/.cyberboss/inbox/memory-v2/claude-candidate-reports/nightly-* reports

LMC-5 reference, read-only temporary clone:

- README and repository tree from https://github.com/wuxuyun0606-collab/lmc-5
- Minimal SQLite backend concepts
- Production backend concepts
- Documentation around five-axis memory, night_dream, patrol, fact evolution, relations, redaction/surface/recall safety, and automation boundaries

## 1. Current Memory V2 Capabilities

### Existing production shape

Current DB tables observed read-only:

- memory_index: 3838 rows
- memory_recall_audit: 313 rows
- memory_review_audit: 3841 rows
- memory_v2_meta: 1 row

Current report pipeline observed:

- Nightly candidate dry-run reports exist through 2026-06-29.
- 2026-06-30 catch-up dry-run was run separately and produced zero candidates.
- Dry-run reports explicitly state DB writes: no, L0 writes: no, schema changes: no, PM2 restart: no.

### What V2 already does well

V2 already has the production-critical basics:

- L0 remains the source of raw conversational evidence.
- Curated memories live separately in Memory V2 DB.
- Candidate mining is report-first and review-first, not direct ingestion.
- Review audit exists as a separate table.
- Recall audit exists as a separate table.
- Recall heat and recall writer are present and guarded.
- Night maintenance dry-run can propose softening, duplicate handling, and insight candidates without writing.
- Backup/rollback tooling exists for controlled write operations.
- Candidate reports are already operational and have nightly cadence.

These parts are good enough and should not be replaced now:

- SQLite production DB for current scale.
- L0 as immutable evidence trail.
- Human-review-first flow for emotionally sensitive memory.
- Existing recall audit and review audit tables.
- Existing dry-run report discipline.
- Existing backup guard for write operations.

### Current gaps V2.5 can address without migration

V2 is stable, but it is mostly entry-centric. It lacks first-class shadow models for:

- M axis: ongoing metabolism/patrol health over old memories.
- Z axis: fact evolution, contradiction detection, and supersession candidates.
- Y axis: relationship/relation candidates between memories.
- Recall safety surfaces that explicitly separate private evidence, safe summaries, and live prompt surfaces.
- A consistent automation boundary document for which parts can be dry-run, proposed, reviewed, and applied.

## 2. LMC-5 Modules Worth Borrowing

### P0: Read-only, low risk

These can be studied or implemented as reports only, with no runtime and no DB writes.

- V2-to-LMC axis mapping document.
- M axis patrol report over existing Memory V2 rows.
- Recall safety surface inventory: what is private, review-only, prompt-safe, and user-visible.
- Automation boundary matrix: dry-run, review, apply, rollback, and stop conditions.
- Redaction audit report over candidate reports and curated memories.

Why P0: all outputs can be files under docs/ or inbox reports. No runtime path needs to read them.

### P1: Dry-run only, never automatic writes

These can produce candidate files, but should not update DB.

- Z axis fact evolution candidates: possible newer fact, older fact, conflict, stale fact.
- Contradiction audit candidates: two memories appear mutually inconsistent.
- M axis decay/softening suggestions: old, low-evidence, or low-heat memories that might need wording changes.
- night_dream-like dry-run report that groups recurring patterns into proposed insights.
- Recall scoring simulation that reports how ordering would differ if patrol/fact signals were considered.

Why P1: outputs may be useful, but false positives are likely. They must stay outside production DB.

### P2: Human-reviewed writes only

These require explicit user approval and backup guard before any DB write.

- Mark memory as superseded_by another memory.
- Add contradiction annotations.
- Add relation edges between memories.
- Add normalized fact lineage records.
- Promote shadow insight candidates into curated memories.
- Apply redaction/surface changes to live recall surfaces.

Why P2: these alter long-term memory behavior and relationship continuity. They need review and rollback.

### P3: Do not touch yet

These are not suitable for current CyberBoss production.

- Replacing Memory V2 with LMC-5.
- PostgreSQL/pgvector backend.
- Automatic night_dream apply.
- Automatic fact supersession.
- Automatic relation edge writes.
- Automatic recall reranking in live replies based on unreviewed signals.
- Any migration that rewrites L0, existing memory_index rows, or review audit history.

## 3. Recommended Upgrade Route

### Phase 0: Read-only research and comparison table

Goal: document where CyberBoss V2 already matches LMC-5 and where V2.5 shadow reports could help.

Files to change:

- docs/memory-v2-v25-shadow-upgrade-plan.md only.

DB writes:

- No.

L0 impact:

- None.

Live reply impact:

- None.

Rollback:

- Delete or revert this doc.

Tests:

- Markdown review only.
- Confirm no production files changed besides docs.

Stop conditions:

- Any request to edit runtime, DB, PM2, .env, cron, or L0.

### Phase 1: M axis read-only patrol report

Goal: generate a read-only patrol report over existing Memory V2 rows.

Proposed files to add later:

- scripts/memory-v2-v25-patrol-dry-run.js
- test/memory-v2-v25-patrol-dry-run.test.js
- docs/memory-v2-v25-patrol.md

Report output path:

- /root/.cyberboss/inbox/memory-v2/v25-patrol-reports/<run-id>/summary.md
- /root/.cyberboss/inbox/memory-v2/v25-patrol-reports/<run-id>/patrol.json

DB writes:

- No.

L0 impact:

- None.

Live reply impact:

- None. Runtime does not read this report.

Rollback:

- Remove the script and reports.
- No DB rollback required.

Tests:

- Unit tests with temp SQLite fixtures.
- Golden-output tests for stale, duplicate, low-evidence, high-risk, and high-heat memories.
- Production smoke with read-only DB handle.

Stop conditions:

- Script opens DB without readOnly.
- Report attempts to update heat, audit, status, or memory text.
- Report proposes deletion instead of review labels.

### Phase 2: Z axis fact evolution candidate report

Goal: detect possible fact evolution without changing existing memories.

Proposed files to add later:

- scripts/memory-v2-v25-fact-evolution-dry-run.js
- test/memory-v2-v25-fact-evolution-dry-run.test.js
- docs/memory-v2-v25-fact-evolution.md

Report output path:

- /root/.cyberboss/inbox/memory-v2/v25-fact-evolution-reports/<run-id>/summary.md
- /root/.cyberboss/inbox/memory-v2/v25-fact-evolution-reports/<run-id>/candidates.json

DB writes:

- No.

L0 impact:

- None.

Live reply impact:

- None.

Rollback:

- Delete generated reports and revert scripts.

Tests:

- Fixture pairs: newer preference replaces older preference, temporary state expires, contradiction false positive, stable identity should not be superseded.
- Verify no writes by checking DB size and mtime before/after.

Stop conditions:

- Any automatic supersede field write.
- Any claim that a contradiction is final instead of candidate.
- High false-positive rate on relationship or medical/body-state memories.

### Phase 3: Y axis relation candidate dry-run

Goal: propose relation edges between memories without writing them.

Proposed files to add later:

- scripts/memory-v2-v25-relation-candidates-dry-run.js
- test/memory-v2-v25-relation-candidates-dry-run.test.js
- docs/memory-v2-v25-relations.md

Candidate relation types:

- supports
- refines
- contradicts_candidate
- supersedes_candidate
- same_theme
- evidence_for
- should_not_merge

DB writes:

- No.

L0 impact:

- None.

Live reply impact:

- None.

Rollback:

- Delete reports and revert scripts.

Tests:

- Pairing tests for near-duplicates, relationship commitments, operational notes, transient moods, and system instructions.
- Ensure no relation edge table is created in production.

Stop conditions:

- Any automatic relation table creation in production.
- Any relation candidate generated from unsafe/private text without redaction in summary.
- Any edge applied without user review.

### Phase 4: Let recall ranking reference read-only signals

Goal: simulate and later optionally use reviewed shadow signals to improve recall ordering.

Proposed files to add later:

- scripts/memory-v2-v25-recall-ranking-rehearsal.js
- test/memory-v2-v25-recall-ranking-rehearsal.test.js
- docs/memory-v2-v25-recall-ranking.md

DB writes:

- Phase 4a: No. Rehearsal only.
- Phase 4b: Still no production writes; runtime may read a reviewed static report only if explicitly approved.

L0 impact:

- None.

Live reply impact:

- Phase 4a: none.
- Phase 4b: possible ranking-only impact, gated behind config flag default off.

Rollback:

- Disable config flag.
- Remove report path from runtime config.
- Revert script.

Tests:

- Recall rehearsal before/after on fixed prompts.
- Regression tests that high-risk, stale, or contradicted memories do not get boosted.
- Live reply shadow logs only before any visible behavior change.

Stop conditions:

- Any unreviewed candidate affects live prompt.
- Any increase in unsafe recall surface.
- Any unexplained recall_count, last_recalled_at, heat, or audit changes during rehearsal.

### Phase 5: Controlled write test

Goal: after user approval, test one narrow write path on a staging copy or explicitly backed-up production DB.

Candidate write types:

- Add reviewed relation edge table in staging only.
- Add reviewed fact lineage metadata in staging only.
- Add reviewed superseded_by metadata in staging only.

Files to change later:

- src/memory-v2/schema.js, only after migration design review.
- src/memory-v2/store.js, only with tests.
- scripts/memory-v2-v25-apply-reviewed-*.js.
- test/memory-v2-v25-*.test.js.
- docs/memory-v2-v25-write-rollback.md.

DB writes:

- Yes, but only after explicit user approval and backup guard.

L0 impact:

- None. L0 remains immutable.

Live reply impact:

- None until a separate, approved recall integration phase.

Rollback:

- Use memory-v2-backup.js guard before write.
- Verify backup hash.
- Restore DB backup if any post-write metric is wrong.

Tests:

- Migration tests.
- Apply/revert tests.
- Backup restore drill.
- DB metric diff before/after.

Stop conditions:

- Backup verification fails.
- Any migration touches L0.
- Any write changes memory text without review artifact.
- Any recall behavior changes without separate approval.

## 4. First Minimal Executable Task

The safest first PR should contain exactly one file:

- docs/memory-v2-v25-shadow-upgrade-plan.md

It should not include:

- runtime code
- scripts
- tests
- DB migration
- PM2 restart
- cron changes
- .env changes
- production data writes

Validation for the first PR:

- Confirm git diff contains only docs/memory-v2-v25-shadow-upgrade-plan.md.
- Confirm Memory V2 DB size and mtime are unchanged.
- Confirm no PM2 restart occurred.
- Confirm no new cron/systemd timers were added.

## 5. What Requires Manual Confirmation

Manual confirmation is required before:

- Any DB write.
- Any schema migration.
- Any relation edge write.
- Any fact supersession write.
- Any contradiction marker write.
- Any recall ranking change that affects live replies.
- Any redaction/surface policy that hides or exposes memories.
- Any recurring job beyond read-only report generation.
- Any move from SQLite to PostgreSQL/pgvector.
- Any LMC-5 migration or production backend adoption.

## 6. Conclusion

Do not do V3 now.

Memory V2 is stable enough to keep as production. LMC-5 should be treated as a design reference, not a replacement. The right next step is V2.5 shadow: read-only patrol, fact-evolution candidates, relation candidates, and recall-ranking rehearsal.

Recommended next PR:

- Only this document: docs/memory-v2-v25-shadow-upgrade-plan.md.

Recommended first implementation after that, only if approved:

- Phase 1 M-axis patrol dry-run report, read-only, runtime-disconnected, no DB writes.

The high-risk items that must wait for explicit approval are automatic supersession, relation edge writes, live recall reranking, and any production DB schema change.
