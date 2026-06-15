# Memory V2 Recall And Heat Design

Status: design only
Production schema changed: no
Production database changed: no

## Goals

The recall and heat mechanism must express actual use, not visibility:

- A memory becomes warmer only when its body is selected and delivered for
  reasoning or response generation.
- Searching, listing, ranking, reviewing metadata, or opening a directory does
  not count as recall.
- Heat remains within `0.05` and `3.0`.
- `last_recalled_at` records the time of actual use.
- Pinned memories do not decay.
- Nightly decay applies only to L1 derived memory. L0 conversation records are
  immutable and outside this mechanism.

## Current State

The current staged Memory V2 implementation already provides:

- `memory_index.heat REAL NOT NULL DEFAULT 0.05`
- a database check constraint limiting heat to `0.05..3.0`
- `memory_index.last_recalled`
- `memory_index.pinned`
- metadata-only `search()` that does not update heat
- `recall()` that returns content and raises heat by `0.3`, capped at `3.0`

This is directionally correct. The remaining work is to make the contract
explicit, auditable, concurrency-safe, and ready for decay.

## Layer Boundary

### L0

L0 is the append-only conversation source under:

`/root/.cyberboss/conversations/YYYY-MM-DD.jsonl`

L0 never receives heat, recall timestamps, softening state, or decay writes.
Memory V2 may retain source references to L0, but no maintenance task may edit
those source files.

### L1

`memory_index` is the L1 derived-memory directory and body store. Heat, recall,
pinning, review status, softening, and future maintenance metadata belong here.

### L2 Insight

Future synthesized insights should also be stored outside L0 and must retain
`source_ids`. They may use the same heat contract but should be distinguishable
by `memory_type = 'insight'`.

## Field Plan

### Keep

| Current field | Decision |
| --- | --- |
| `heat` | Keep with the existing `0.05..3.0` constraint. |
| `pinned` | Keep. It is the decay-immunity flag. |
| `updated_at` | Keep for general row mutation time. |
| `source_message_ids` | Keep as the L0 provenance link. |

### Rename Or Add

| Field | Type | Purpose |
| --- | --- | --- |
| `last_recalled_at` | `TEXT NULL` | Canonical UTC time when content was truly consumed. |
| `recall_count` | `INTEGER NOT NULL DEFAULT 0` | Number of accepted recall events. |
| `last_decayed_at` | `TEXT NULL` | Prevent repeated decay for the same maintenance window. |
| `softened_at` | `TEXT NULL` | Time L1 memory was softened by maintenance. |
| `softening_reason` | `TEXT NOT NULL DEFAULT ''` | Human-readable maintenance reason. |

The current `last_recalled` should be treated as the legacy name for
`last_recalled_at`. Do not drop it in the first migration.

### Add Audit Table

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

`event_id` makes retries idempotent. A repeated delivery attempt with the same
event ID must not raise heat twice.

## API Contract

### `search(query, options)`

Purpose: rank and return directory metadata.

- Read-only.
- Must not return `content`.
- Must not update heat, recall count, or timestamps.
- May order by pinned, heat, semantic score, and source time.

### `getMetadata(id)`

Purpose: inspect directory metadata.

- Read-only.
- Never counts as recall.

### `review(id)` and audit tools

Purpose: maintenance and human review.

- May display the body to an authorized reviewer.
- Does not count as conversational recall.
- Must not raise heat.

This distinction prevents maintenance scans from making every inspected memory
artificially hot.

### `recall(id, context)`

Purpose: retrieve a body that will actually be consumed by the model or user
response pipeline.

Required context:

```js
{
  eventId: "recall_<stable-id>",
  consumer: "claudecode|deepseek|codex|manual",
  purpose: "response_context|reasoning|explicit_user_request",
  sourceTurnId: "optional-turn-id"
}
```

Behavior:

1. Require an active or explicitly allowed pending memory.
2. Start one transaction.
3. Insert `event_id` into `memory_recall_audit`.
4. If `event_id` already exists, return the body without another heat increase.
5. Atomically set:
   - `heat = MIN(3.0, MAX(0.05, heat) + 0.3)`
   - `last_recalled_at = recalled_at`
   - `last_recalled = recalled_at` during compatibility period
   - `recall_count = recall_count + 1`
   - `updated_at = recalled_at`
6. Commit and return the body plus updated metadata.

The update must use the heat value in SQL, not a stale value read before a
concurrent recall:

```sql
UPDATE memory_index
SET heat = MIN(3.0, MAX(0.05, heat) + 0.3),
    last_recalled_at = :now,
    last_recalled = :now,
    recall_count = recall_count + 1,
    updated_at = :now
WHERE id = :id;
```

### `peekBody(id)`

If an administrative body inspection endpoint is needed, name it explicitly
and make it read-only. Do not overload `recall()` with a flag that silently
disables heat; that would make usage accounting unreliable.

## Heat Policy

### Initial Heat

- Newly extracted L1 candidates: `0.05`
- Newly approved memories: preserve current heat
- Pinned memory: pinning does not automatically set heat to `3.0`
- New insight: start at `0.10` unless it is immediately recalled

Pin and heat represent different things:

- pin means "must survive decay"
- heat means "recently useful"

### Recall Increase

Default increment: `+0.30`.

The first implementation should use one increment for all real recalls. More
complex weighting by consumer or purpose can be considered only after recall
audit data exists.

### Decay

Nightly decay is L1-only and dry-run-first.

Eligibility:

- `status = 'active'`
- `pinned = 0`
- `memory_type != 'l0'`
- no recall within the grace period
- not already decayed in the current maintenance window

Proposed initial policy:

| Time since true recall | Multiplier |
| --- | ---: |
| less than 14 days | `1.00` |
| 14 to 29 days | `0.95` |
| 30 to 89 days | `0.90` |
| 90 days or more | `0.85` |

The floor is always `0.05`. Decay does not invalidate or delete a memory.
Pinned memories are excluded before calculation.

## Migration Plan

This is a schema migration and therefore must not be applied directly to
production.

### Phase 0: Read-Only Preflight

Generate a report containing:

- current schema version and columns
- row count and status counts
- heat minimum, maximum, and out-of-range count
- non-null and malformed `last_recalled` counts
- pinned/invalid conflicts
- duplicate IDs and source keys
- database integrity result

No writes.

### Phase 1: Disposable-Copy Dry Run

1. Create a verified online backup.
2. Copy that backup to a disposable database.
3. Apply additive migration only to the disposable copy:

```sql
ALTER TABLE memory_index ADD COLUMN last_recalled_at TEXT;
ALTER TABLE memory_index ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_index ADD COLUMN last_decayed_at TEXT;
ALTER TABLE memory_index ADD COLUMN softened_at TEXT;
ALTER TABLE memory_index ADD COLUMN softening_reason TEXT NOT NULL DEFAULT '';
```

4. Create `memory_recall_audit`.
5. Backfill `last_recalled_at = last_recalled` where valid.
6. Do not invent `recall_count` from heat. Historical heat does not prove how
   many recalls occurred.
7. Run integrity and health checks.
8. Produce row-level migration counts and schema diff.

### Phase 2: Compatibility Release

Deploy code that:

- reads `last_recalled_at`, falling back to `last_recalled`
- writes both fields inside one transaction
- treats a missing recall audit table as "recall audit unavailable", not as
  permission to write unsafely
- keeps search and metadata paths read-only

This release should be tested against both old and additive schemas.

### Phase 3: Production Additive Migration

High-risk gate:

- explicit approval
- verified fresh backup
- disposable-copy dry run passed
- no concurrent Memory V2 writer
- migration wrapped in one transaction
- immediate integrity and health checks

No PM2 restart should be assumed. A restart may be considered only if the
running process has a persistent schema-dependent connection and cannot reopen
it safely. That requires a separate risk and rollback explanation.

### Phase 4: Observation

For at least seven days:

- compare recall audit count with `recall_count` deltas
- confirm directory searches never create recall events
- confirm repeated `event_id` is idempotent
- confirm pinned memories never appear in decay proposals
- confirm L0 hashes do not change

### Phase 5: Legacy Column Removal

Do not schedule this now. Removing `last_recalled` requires a table rebuild in
SQLite and is unnecessary while compatibility is useful. Keeping one nullable
legacy column is safer than an early destructive migration.

## Tests Required Before Production

1. Search twice and assert heat and timestamps are unchanged.
2. Metadata and review reads do not create recall audit rows.
3. Recall raises heat exactly once.
4. Duplicate `event_id` does not raise heat twice.
5. Concurrent distinct recalls do not lose increments.
6. Heat caps at `3.0` and never falls below `0.05`.
7. Pinning leaves heat unchanged.
8. Decay proposal excludes pinned records.
9. Decay proposal never references L0 files as write targets.
10. Old-schema and additive-schema compatibility tests pass.
11. Migration dry run preserves row counts, statuses, sources, and content.
12. L0 directory hashes remain unchanged.

## Rollback

Because the production migration is additive, application rollback should
prefer returning to code that ignores the new columns. Do not immediately
remove columns or the recall audit table.

If the migration itself corrupts behavior:

1. Stop Memory V2 writers, not the main chat process by default.
2. Preserve a fresh pre-restore backup.
3. Restore the verified database backup using
   `scripts/memory-v2-backup.js restore`.
4. Run the health check.
5. Verify L0 hashes and PM2 state remain unchanged.

## Decision Summary

- Existing heat range and increment are retained.
- Only real content consumption counts as recall.
- Directory and maintenance reads remain cold.
- Recall becomes transactional and idempotent.
- `last_recalled_at` becomes canonical without immediately deleting the legacy
  column.
- Pinned records are categorically excluded from decay.
- Night maintenance changes only L1 metadata and never L0.
- No production schema or data change is part of this design phase.
