# REST API image (NestJS). Build context = repo root.
#
# Debian (bookworm-slim), not Alpine like the worker (§4): hourly reports (§14) need the
# OFFICIAL `unrar` (RarLab, non-free). Alpine has no unrar package, and unrar-free / p7zip /
# 7-Zip 23 fail on these RAR5 files ("Unsupported Method"). node-unrar-js remains the fallback.

# ---- build: install, compile core/db/api, produce a pruned prod bundle in /out ----
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/whatsapp/package.json apps/whatsapp/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @alarm/api...

COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @alarm/core build \
 && pnpm --filter @alarm/db build \
 && pnpm --filter @alarm/api build

# Self-contained prod node_modules (workspace packages copied in), then generate the Prisma
# client into it (pnpm deploy reinstalls, so the generated client must be recreated).
RUN pnpm --filter @alarm/api deploy --prod /out \
 && cp -r packages/db/prisma /out/prisma \
 && cd /out && /app/packages/db/node_modules/.bin/prisma generate --schema prisma/schema.prisma \
 && rm -rf /out/src /out/prisma/migrations /out/tsconfig*.json \
 && find /out/node_modules -name '*.map' -delete

# ---- runtime ----
FROM node:20-bookworm-slim
# Official unrar lives in Debian's non-free component.
RUN sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends unrar openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && unrar | head -1 \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn*
ENV NODE_ENV=production API_PORT=4100
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
