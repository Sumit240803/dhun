# One image, four ways to run it: api · gateway · worker · migrate.
#
# The three processes share one codebase on purpose (CLAUDE.md § Architecture),
# so they share one image too. A deploy builds this once; each process is the
# same bytes started with a different argument. That is what makes "the API and
# the gateway are on different versions" a state that cannot happen by accident.
#
#   docker build -t dhun-backend backend/
#   docker run --env-file .env dhun-backend api
#   docker run --env-file .env dhun-backend migrate
#
# Node 22 to match CI and local. Alpine for size; nothing here needs glibc.

# ── 1 · build ────────────────────────────────────────────────────────────────
FROM node:22.14.0-alpine3.21 AS build
WORKDIR /src

# Lockfile first, so a source change does not reinstall every dependency.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx tsc -p tsconfig.build.json

# ── 2 · production dependencies only ─────────────────────────────────────────
FROM node:22.14.0-alpine3.21 AS deps
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── 3 · runtime ──────────────────────────────────────────────────────────────
FROM node:22.14.0-alpine3.21 AS runtime

# tini is PID 1, so SIGTERM from Docker reaches Node. Without it the graceful
# shutdowns written into server.ts, gateway/index.ts and workers/index.ts never
# run: in-flight money requests are cut, the outbox is not drained, and the
# event log loses its last batch — exactly the moments those paths exist for.
#
# psql runs ops/roles.sql after every migration (the `migrate` command): the
# grants script uses psql variables, and a migration that adds a table must
# have its append-only revokes applied before the API that uses it starts.
RUN apk add --no-cache tini postgresql16-client

ENV NODE_ENV=production \
    # Source maps make a stack trace in the event log point at TypeScript lines.
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app
COPY --from=deps  --chown=node:node /src/node_modules ./node_modules
COPY --from=build --chown=node:node /src/build ./build
COPY --chown=node:node package.json ./
# Read at runtime relative to the compiled files — see tsconfig.build.json.
COPY --chown=node:node public ./build/public
COPY --chown=node:node migrations ./build/migrations
COPY --chown=node:node ops/roles.sql ./build/ops/roles.sql
# --chmod because a Windows checkout has no executable bit to preserve.
COPY --chown=node:node --chmod=0755 docker/entrypoint.sh /usr/local/bin/dhun

# Never root. A compromised process should not own the container.
USER node

# Recorded into every image by the deploy pipeline; read by /ready so a probe
# can tell which build answered.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

EXPOSE 3000 3001
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/dhun"]
CMD ["api"]
