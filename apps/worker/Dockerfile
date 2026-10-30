# syntax=docker/dockerfile:1.7
# Build from the repository root:  docker build -f apps/worker/Dockerfile .
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --filter "@fim/worker..."
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/worker apps/worker
COPY scripts/prune-optional-peers.mjs scripts/
RUN pnpm --filter "@fim/worker..." run build \
 && pnpm --filter "@fim/worker" deploy --prod --legacy /out \
 && node scripts/prune-optional-peers.mjs /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "dist/index.js"]
