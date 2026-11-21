# Smart-Waste API image for Render / Railway (and any Docker host).
# Builds the shared package + API from the monorepo root.

FROM node:24-bookworm-slim AS build
WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Sources needed before install: root postinstall builds @smart-waste/shared,
# so tsconfig + shared sources must already be present.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts

# Install only the workspaces the API needs (skips mobile/admin native tooling).
# --ignore-scripts: we build explicitly after the full API source is copied.
RUN npm ci --workspace=@smart-waste/shared --workspace=@smart-waste/api --include-workspace-root --ignore-scripts

COPY apps/api apps/api

RUN npm run build -w @smart-waste/shared \
  && npm run build -w @smart-waste/api

FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV UPLOADS_DIR=/data/uploads
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/uploads

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts

# Keep prisma available so `migrate deploy` works at boot.
# Ignore lifecycle scripts (root postinstall needs shared sources we don't copy here).
RUN npm ci --workspace=@smart-waste/shared --workspace=@smart-waste/api --include-workspace-root --ignore-scripts \
  && npm cache clean --force \
  && cd apps/api && npx prisma generate

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/src/generated apps/api/src/generated

WORKDIR /app/apps/api
EXPOSE 4000

# Apply pending migrations, then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
