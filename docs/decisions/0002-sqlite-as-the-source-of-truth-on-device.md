# 0002: SQLite is the source of truth on the device

**Status:** accepted

## Context

Assessors work in basements, rural areas and parking garages. Every action must work with no
signal and survive the OS killing the app.

## Decision

Jobs, templates, drafts, answers, photo metadata, damage pins, GPS points and the sync outbox
live in SQLite (`expo-sqlite`, WAL mode) behind Drizzle. Screens read through repository
functions and re-render on `addDatabaseChangeListener`, so the UI only ever shows what is
on disk. Every user action is written to SQLite before anything touches the network. Photos
and signatures are files in the document directory; SQLite stores their paths.

Repositories use Drizzle's synchronous API (`.all()`, `.get()`, `.run()`), which works on both
`expo-sqlite` and `better-sqlite3`, so the sync engine and repositories are tested in Node
against a real SQLite file with the same migrations.

## Consequences

- No "unsaved changes" state: a killed app reopens exactly where the assessor left off.
- Server-state screens for managers use TanStack Query instead (they need a connection anyway).
- Local schema changes need forward-only migrations tracked with `PRAGMA user_version`.
