# Memory V2 Night Maintenance Dry Run

Status: implemented as read-only analysis
Automatic database writes: disabled

## Purpose

The nightly pass prepares evidence and proposals. It does not apply them.
Every proposed mutation remains a separate, reviewable future operation.

The dry-run covers:

- softening old low-heat L1 memories
- identifying stale graph edges when a supported edge table exists
- grouping exact semantic-normalized duplicates
- identifying structured fact conflicts when key/value fields exist
- proposing a small number of provenance-preserving INSIGHT records

## Run

```bash
node scripts/memory-v2-night-maintenance-dry-run.js \
  --db /root/.cyberboss/memory-v2.sqlite \
  --output-dir /root/.cyberboss/inbox/memory-v2/night-reports \
  --soften-heat 0.2 \
  --soften-age-days 90 \
  --max-insights 5
```

The command opens SQLite read-only, enables `PRAGMA query_only`, verifies
integrity, and writes only JSON and Markdown report files outside the database.

## Softening

A candidate must be:

- active
- unpinned
- heat at or below the configured threshold
- older than the configured cutoff using true recall time when available,
  otherwise source time

The proposal lowers heat by a factor of `0.85`, with a floor of `0.05`.
Softening never invalidates or deletes a memory. L0 is never a write target.

## Stale Graph Edges

The analyzer supports `memory_edges` or `memory_graph_edges` when recognizable
source and target columns exist. An edge is stale when either endpoint is
missing or not active.

The current production schema may not have a graph table. In that case the
report explicitly says the check is unsupported. It does not report a false
zero as proof that no stale edges exist.

## Duplicate Memories

Duplicate grouping is intentionally conservative:

- active records only
- Unicode-normalized, case-folded, whitespace-normalized content
- exact equality after normalization

The candidate names a preferred survivor based on pin, heat, recency, and ID.
The dry-run does not merge or invalidate any row.

## Fact Conflicts

Automatic conflict detection requires structured fields:

- `fact_key` or `canonical_key`
- `fact_value` or `canonical_value`

Multiple active normalized values for one key become a conflict-review
proposal. Without structured fields, free text is not labeled automatically;
the report marks conflict analysis unsupported to avoid invented conclusions.

## INSIGHT Proposals

At most `--max-insights` candidates are emitted. Every candidate:

- has `memoryType: insight`
- remains `pending`
- starts at heat `0.1`
- includes `source_ids`
- includes source Memory V2 IDs
- is derived only from repeated matching evidence

No candidate without source IDs is emitted. The dry-run does not insert an
INSIGHT.

## Apply Boundary

Applying any proposal is a separate high-risk phase.

Before a future apply:

1. Obtain explicit approval for the candidate set.
2. Run the health check.
3. Create and verify a fresh backup through the backup guard.
4. Revalidate candidate IDs and current states.
5. Apply transactionally with an audit row for every mutation.
6. Never modify L0.
7. Run integrity and health checks afterward.

Bulk state changes, graph-edge deletion, schema migration, and INSIGHT
insertion are not implemented by this dry-run tool.

## Report Interpretation

The JSON report is machine-readable. The Markdown report is for handoff.
Both include a safety block whose expected values are:

```json
{
  "databaseWrites": 0,
  "l0Writes": 0,
  "statusChanges": 0,
  "edgeDeletes": 0,
  "insightInserts": 0,
  "requiresBackupToApply": true,
  "requiresExplicitApprovalToApply": true
}
```

Any future version that changes those values is no longer a dry-run and must
be reviewed as a separate writer.
