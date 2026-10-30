# 0005: Resumable multipart uploads straight to S3

**Status:** accepted

## Context

An inspection can have 100+ photos. Proxying them through the API wastes API capacity, and a
restart mid-upload must not start the file again.

## Decision

The submission includes a manifest of photo ids (generated on the device). For each file the app
calls `POST /photos/upload`; the API opens an S3 multipart upload (or reopens the stored one),
asks S3 which parts it already holds (`ListParts`), and returns pre-signed `UploadPart` URLs only
for the missing parts. The device uploads from disk with the native uploader, records each
part's ETag in the outbox row, then calls `POST /photos/complete`. Completing twice is a no-op;
if the multipart upload expired but the object exists, it is treated as done. When the last file
lands the API queues the PDF job.

Parts are 5 MiB (the S3 minimum), so compressed photos are usually one part; the mechanism still
resumes across files and across larger images.

## Consequences

- The API never touches photo bytes; S3 does the heavy lifting.
- An S3 lifecycle rule aborts multipart uploads abandoned for 7 days.
