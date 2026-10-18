# Verity — containerized production runtime (Task 30).
#
# Three stages: install dependencies once, build once, run from the smallest
# possible image. Debian ("bookworm-slim"), not Alpine, in every stage —
# Prisma's native query-engine binary has a long history of extra friction
# under musl libc, and this task's own instruction is "do not optimize
# prematurely." All three stages share one base so the Prisma client
# `prisma generate` writes in the builder stage is binary-compatible with
# the runner stage that executes it — building on the host and copying in a
# host-built .next/standalone would NOT be portable (verified locally: a
# Windows dev build produces `query_engine-windows.dll.node`, useless here).
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base
# Prisma's query engine and CLI detect libssl at startup; the slim image ships none, so every Prisma
# command warned and fell back to openssl-1.1.x (Stage 1 finding D4). Shared by every stage so the
# engine generated in the builder matches the one the runner executes. Runs as root before the
# non-root user is created; apt lists are removed to keep the layer small.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
# package-lock.json only — `npm ci` needs exactly this file, and layer caching
# means this expensive step reruns only when dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# BUILD-TIME vs RUNTIME, made explicit (see taskplans/30_containerized_runtime.md §"Build-time vs runtime configuration"):
#
# NEXT_PUBLIC_* variables are inlined into the browser bundle BY `next build`
# — there is no "runtime" for them, Next.js's own architecture requires the
# real value here. Neither is a secret: NEXT_PUBLIC_SUPABASE_ANON_KEY is
# designed for exactly this exposure (protected by Postgres RLS, not by
# secrecy — see .env.example's own comment on it).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# Placeholders when unset, for the same reason DATABASE_URL has one below:
# `next build` imports every route module to collect page data, and
# `config.ts` validates the Supabase variables at import time when the auth
# provider is `supabase` (its default). An OIDC-only deployment (Task 36) has
# no Supabase project at all, and without these defaults its image could not be
# built — the boundary would be real in the code and fictional in the package.
#
# Harmless: these are inlined into the browser bundle, and a deployment that
# actually uses Supabase must pass the real values as build args, exactly as
# before. An unusable placeholder fails loudly at sign-in rather than silently
# authenticating against something.
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-https://build-placeholder.invalid}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY:-build-placeholder-anon-key}
# Same reasoning, one layer deeper: `config.ts` also requires a cookie-signing
# secret, which on a Supabase deployment falls back to the anon key and on an
# OIDC one must be set explicitly. `next build` needs *a* value to import the
# module; the deployment needs a real one.
#
# This cannot leak into the runtime image: `runner` starts from `base`, not
# from `builder`, so no ENV set here survives into the image that serves
# traffic. The running container is given the real value by compose, and a
# deployment with none is refused by `deploy/security/preflight.sh` before it
# ever starts.
ENV VERITY_SESSION_SECRET=${VERITY_SESSION_SECRET:-build-placeholder-session-secret-not-used-at-runtime}

# DATABASE_URL is NOT inlined anywhere — it is read from `process.env` only
# when the running server actually needs it. But `src/server/platform/config.ts`
# validates it as non-empty at module import time (Task 26), and `next build`
# imports every route/layout module during "Collecting page data" to build
# the route manifest — confirmed locally: every route in this app renders
# dynamically (ƒ), so this import happens for all of them. A syntactically
# valid placeholder satisfies that check without needing real credentials
# at image-build time; the real value is supplied at `docker run`/Compose
# time below and overrides this one, since it is never baked into any file.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build_placeholder"
# `prisma generate` resolves every env() reference in the schema's datasource
# block eagerly, DIRECT_URL included, even though generate itself never
# connects — an undefined (not merely empty) var fails the whole build with
# "Environment variable not found: DIRECT_URL". Same placeholder reasoning
# as DATABASE_URL above.
ENV DIRECT_URL="postgresql://build:build@localhost:5432/build_placeholder"
ENV NODE_ENV=production

RUN npm run build

# ---------------------------------------------------------------------------
# The operator toolchain (Task 43).
#
# WHY THIS STAGE EXISTS — found empirically, not designed in advance.
#
# The `runner` stage below contains only `.next/standalone`: the traced subset
# of node_modules, the server entrypoint and static assets. That is correct for
# a runtime image and it is precisely why `npx prisma migrate deploy` cannot run
# in it — the Prisma CLI is a devDependency, `prisma/migrations/` is not copied,
# and `npx` in an offline container cannot fetch either.
#
# Task 42's migrate.sh and bootstrap.sh were written against `web`, and the
# containerized acceptance run is what surfaced it. The fix is a separate stage
# with the full dependency tree and the schema, used by those two scripts and by
# nothing that serves traffic: the runtime image stays minimal, and the
# migration path stops depending on a container that was deliberately stripped.
FROM base AS tools
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src/server ./src/server
# Generated against this image's own platform, so the engine matches.
RUN npx prisma generate
# Migrations are run by an operator through deploy/scripts/migrate.sh. This
# image has no CMD that would run one on start: baking migration into container
# start makes every restart a potential schema change (Task 30's decision).
CMD ["node", "--version"]

# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js's own documented standalone-output convention: a dedicated
# non-root user, not root. `nextjs`/1001 matches the upstream
# `create-next-app` Docker example so this is a known-good, not invented,
# arrangement.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Only what `.next/standalone` actually needs to run: the traced
# node_modules subset (Prisma's engine included — see next.config.ts's
# `outputFileTracingIncludes`), the server entrypoint, static assets, and
# public files. No source, no devDependencies, no build tooling.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts/run-scheduler.mjs ./scripts/run-scheduler.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/scheduler-time.mjs ./scripts/scheduler-time.mjs

# Migrations are deliberately NOT run here — see the taskplan's "Database /
# migration model" section. Baking `prisma migrate deploy` into the image
# entrypoint would make every container start a potential schema change,
# which this task's own instruction explicitly forbids ("do not silently
# make every application startup perform destructive or uncontrolled
# migrations"). Task 31 owns the bootstrap/migration model; this image
# only runs the built application.

USER nextjs
EXPOSE 3000

# The standalone server.js IS the entrypoint next.config.ts's `output:
# "standalone"` produces — no `next start`, no process manager. Verified in
# node_modules/next/dist/server/lib/start-server.js: it registers its own
# SIGTERM/SIGINT handlers that close the HTTP server gracefully, so
# `docker stop` terminates it cleanly with no wrapper process needed. Running
# as PID 1 (no shell form, no `sh -c`) means that signal reaches Next
# directly rather than a shell that would need to forward it.
CMD ["node", "server.js"]
