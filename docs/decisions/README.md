# Architecture decision records

Short records of the decisions that shape this codebase. Each one states the context, the
decision and what it costs.

| #                                                               | Decision                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| [0001](0001-monorepo-with-shared-schemas.md)                    | pnpm monorepo with Zod schemas shared by app, API and worker |
| [0002](0002-sqlite-as-the-source-of-truth-on-device.md)         | SQLite (Drizzle) is the source of truth on the device        |
| [0003](0003-durable-outbox-for-sync.md)                         | A durable outbox drives all device-to-server sync            |
| [0004](0004-idempotent-submission-and-optimistic-versioning.md) | Idempotent submission with optimistic versioning             |
| [0005](0005-resumable-multipart-uploads.md)                     | Photos go straight to S3 as resumable multipart uploads      |
| [0006](0006-delta-sync-with-keyset-cursors.md)                  | Delta sync with keyset cursors and an overlap window         |
| [0007](0007-transactional-outbox-and-pdf-worker.md)             | Transactional outbox in Postgres feeds an SQS worker         |
| [0008](0008-photo-processing-on-device.md)                      | Photos are resized, watermarked and compressed on the device |
