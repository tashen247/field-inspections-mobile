# 0007: Transactional outbox in Postgres feeds an SQS worker

**Status:** accepted

## Context

Submitting, finishing uploads and approving must trigger a PDF render and push notifications.
Sending to SQS inside the request would lose jobs if SQS is down after the database commit, or
send jobs for transactions that roll back.

## Decision

Jobs are inserted into `job_outbox` in the same transaction as the state change. After commit the
API relays them to SQS, and a 5-second sweep (claiming rows with `FOR UPDATE SKIP LOCKED`)
retries anything left behind. The worker long-polls SQS and deletes a message only after its
handler succeeds; failures reappear after the visibility timeout and move to a DLQ after five
attempts (with a CloudWatch alarm). Handlers are idempotent: a report already rendered for the
inspection's current version is skipped, and dead Expo push tokens are pruned.

The report is rendered with `pdf-lib` rather than headless Chromium: no browser in the worker
image, fast cold starts, and deterministic output. The correlation id from the original request
travels as an SQS message attribute, so one id links API and worker logs.

## Consequences

- At-least-once delivery with idempotent consumers, so effectively once.
- Report layout is code rather than HTML/CSS, which is more verbose to change.
