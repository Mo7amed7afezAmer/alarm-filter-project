# WhatsApp sender image (Baileys). Build context = repo root. Internal only: the api calls it on
# :4300; the linked-number session lives in the `whatsapp` volume (/app/session).

# ---- build: install, compile core + sender, produce a pruned prod bundle in /out ----
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/whatsapp/package.json apps/whatsapp/
RUN pnpm install --frozen-lockfile --filter @alarm/whatsapp...

COPY packages/core packages/core
COPY apps/whatsapp apps/whatsapp
RUN pnpm --filter @alarm/core build && pnpm --filter @alarm/whatsapp build

RUN pnpm --filter @alarm/whatsapp deploy --prod /out \
 && rm -rf /out/src /out/tsconfig*.json \
 && find /out/node_modules -name '*.map' -delete

# ---- runtime ----
FROM node:20-alpine
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn*
ENV NODE_ENV=production WHATSAPP_SESSION_DIR=/app/session
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /app/session && chown node:node /app/session
USER node
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4300/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
