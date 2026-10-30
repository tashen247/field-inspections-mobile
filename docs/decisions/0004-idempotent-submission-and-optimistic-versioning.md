# 0004: Idempotent submission with optimistic versioning

**Status:** accepted

## Context

A submission can reach the server while its response is lost. The retry must not create a
second submission. Separately, a manager may reassign or edit a job while the assessor is
offline; the app must never silently overwrite that.

## Decision

`PUT /v1/inspections/:id/submission` requires an `Idempotency-Key` generated once when the
submission is queued and reused on every retry. The handler runs in one transaction under a
Postgres advisory lock on (user, key): a repeat with the same body returns the stored response
(header `idempotent-replayed: true`); the same key with a different body is a 422. Failed
attempts roll back and store nothing, so they can be retried with the same key.

Every inspection has a `version`, bumped by manager edits, assignment, review and submission
(starting a job does not bump it). The device sends the `baseVersion` it downloaded. A mismatch
returns 409 with the reason (`modified`, `reassigned` or `closed`) and the current server copy.
The app parks the inspection on a conflict screen. For `modified` the assessor can resend on
the latest version (rebased payload, new idempotency key) or discard; for the other two they
can only discard.

## Consequences

- Exactly-once effects without distributed transactions.
- Idempotency rows accumulate; a periodic cleanup of keys older than 30 days is a small follow-up.
