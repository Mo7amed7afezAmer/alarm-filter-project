# Web image (Next.js standalone). Build context = repo root.
#
# Pages + NextAuth sign-in only: /api/* is proxied to the NestJS api service (apps/api, which
# also does the hourly-report RAR extraction). The proxy target is fixed at build time (Next.js
# rewrites) — pass --build-arg API_URL when the api service is not http://api:4100.

# ---- build ----
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @alarm/web...

COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/web apps/web
ARG API_URL=http://api:4100
ENV NEXT_TELEMETRY_DISABLED=1 API_URL=${API_URL}
RUN pnpm --filter @alarm/core build \
 && pnpm --filter @alarm/db build \
 && pnpm --filter @alarm/web build

# Standalone tracing does not always pick up Prisma's query engine under pnpm: copy the
# generated client (with the debian-openssl-3.0.x engine) next to every traced @prisma/client.
RUN for d in apps/web/.next/standalone/node_modules/.pnpm/@prisma+client@*/node_modules; do \
      cp -r node_modules/.pnpm/@prisma+client@*/node_modules/.prisma "$d/"; \
    done

# ---- runtime ----
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
