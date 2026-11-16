# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN npm install -g pnpm@11.25.0 turbo@2.10.12
# No git hooks inside images (husky runs from the root "prepare" script).
ENV HUSKY=0
WORKDIR /app

# Keep only web + the workspace packages it depends on (@repo/api, @repo/ui, configs).
FROM base AS pruner
COPY . .
RUN turbo prune web --docker

FROM base AS builder
# Dependency layer: only rebuilt when a relevant package.json or the lockfile changes.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .

# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time;
# setting them on the running container has no effect. Empty = code defaults.
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN

# Builds @repo/api (compiled to dist/) first via "^build", then web.
RUN turbo run build --filter=web

FROM node:24-alpine AS runner
RUN npm install -g pnpm@11.25.0
WORKDIR /app
ENV NODE_ENV=production
COPY --from=pruner /app/out/json/ .
# --ignore-scripts: the root "prepare" script calls husky, a devDependency that --prod doesn't install.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=builder /app/apps/web/next.config.js ./apps/web/
# Owned by "node" because Next.js writes its runtime cache into .next/cache.
COPY --from=builder --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public

WORKDIR /app/apps/web
# Run as the unprivileged "node" user that ships with the official Node image, not root.
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=3 --start-period=15s \
  CMD wget -q --spider http://localhost:3000/ || exit 1
# web has no "start" script, so call next directly.
CMD ["./node_modules/.bin/next", "start", "-p", "3000"]
