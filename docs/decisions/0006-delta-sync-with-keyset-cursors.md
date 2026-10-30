# 0006: Delta sync with keyset cursors and an overlap window

**Status:** accepted

## Context

Assessors pull only what changed. Offset pagination skips or repeats rows when data changes
between pages, and `updated_at > since` misses rows written by transactions that commit after
the read.

## Decision

`GET /v1/inspections?assignedTo=me&since=…` orders by `(updated_at, id)` and pages with an opaque
cursor holding the last row's microsecond timestamp and id, plus the first page's `serverTime`
so every page reports the same value. `serverTime` is set 30 seconds in the past, so the next
delta overlaps slightly; the device upserts, so repeats are harmless. Jobs reassigned away from
the caller come back as `removedIds`, read from the audit trail. A composite index on
`(assignee_id, updated_at, id)` keeps this fast: p95 stays well under the 200 ms target with 5,000 inspections (roughly 15 to 40 ms locally)
(`pnpm --filter @fim/api bench:sync`, also run in CI against the 200 ms target).

## Consequences

- No missed or duplicated rows, without long-lived server-side sync state.
- Deletions are modelled as reassignment events rather than hard deletes.
