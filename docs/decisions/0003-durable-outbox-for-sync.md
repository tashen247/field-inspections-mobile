# 0003: A durable outbox drives all sync

**Status:** accepted

## Context

Submitting is several requests: start, submission data, then one upload per photo and the
signature. Any of them can fail, and the app can die between any two.

## Decision

"Submit" writes one transaction: the submission payload, a fresh idempotency key, and one upload
op per file, into an `outbox` table. The `SyncEngine` processes ops strictly in id order per
inspection (uploads of one inspection may run side by side once their submission is done):

- network errors stop the run and back off (5 s doubling to 10 min);
- 5xx and 429 retry with backoff;
- 409 conflicts block the inspection until the assessor decides;
- other 4xx and missing local files mark the op failed with a visible reason;
- on start-up, ops left `in_flight` by a killed process go back to `pending`.

It runs on app start, on regaining connectivity, on returning to the foreground, every minute
while open, and from `expo-background-task` when closed.

## Consequences

- Data is never lost and never sent twice (see 0004 and 0005).
- The sync screen can show exactly what is pending, retrying or failed, per inspection.
- Background execution is best-effort and OS-scheduled; foreground triggers do most of the work.
