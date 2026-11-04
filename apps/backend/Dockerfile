# syntax=docker/dockerfile:1
# One Dockerfile, two images:  --target api  (HTTP server)  |  --target worker  (SQS pollers)

FROM node:24-alpine AS base
RUN npm install -g pnpm@11.25.0 turbo@2.10.12
# No git hooks inside images (husky runs from the root "prepare" script).
ENV HUSKY=0
WORKDIR /app

# Keep only backend + the workspace packages it depends on.
# out/json = package.json files + pruned lockfile, out/full = their source.
FROM base AS pruner
COPY . .
RUN turbo prune backend --docker

FROM base AS builder
# Dependency layer: only rebuilt when a relevant package.json or the lockfile changes.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# Builds workspace dependencies first (turbo.json "^build"), then backend.
RUN turbo run build --filter=backend

FROM node:24-alpine AS runtime
RUN npm install -g pnpm@11.25.0
WORKDIR /app
ENV NODE_ENV=production
COPY --from=pruner /app/out/json/ .
# --ignore-scripts: the root "prepare" script calls husky, a devDependency that --prod doesn't install.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

FROM runtime AS worker
CMD ["node", "apps/backend/dist/main-worker"]

# Last stage = default target.
FROM runtime AS api
# The app defaults to 5001; pin it so EXPOSE and the health check agree.
ENV PORT=5000
EXPOSE 5000
# /metrics is outside the /api prefix and version-neutral, so its path is stable.
HEALTHCHECK --interval=5s --timeout=3s --retries=3 --start-period=20s \
  CMD wget -q --spider http://localhost:5000/metrics || exit 1
CMD ["node", "apps/backend/dist/main"]
