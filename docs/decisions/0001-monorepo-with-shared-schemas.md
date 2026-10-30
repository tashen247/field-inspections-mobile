# 0001: pnpm monorepo with shared Zod schemas

**Status:** accepted

## Context

The app, API and worker all handle the same shapes: inspections, templates, submissions,
upload slots, jobs. Checklist rules (required items, ranges, required photos) must be identical
on the device, which blocks submit, and on the server, which rejects bad data.

## Decision

One pnpm workspace: `apps/mobile`, `apps/api`, `apps/worker`, `packages/shared`, `packages/db`
and `infra`. `packages/shared` holds Zod schemas, inferred types and pure functions such as
`validateChecklist`, compiled to plain ESM so Metro and Node load the same build. Fastify
validates requests and responses with those schemas (`fastify-type-provider-zod`) and generates
the OpenAPI document at `/docs` from them. `packages/db` holds the Drizzle schema and SQL
migrations for the API and worker.

## Consequences

- A contract change is a compile error in every consumer, not a runtime surprise.
- The shared package must stay free of Node-only and React Native-only imports.
- Libraries need building before the apps (`pnpm build:libs`, run by every root script).
