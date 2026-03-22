# ─── Stage 1: Builder ────────────────────────────────────────────────────────
# Build the Next.js standalone output. Requires native addon build tools for
# better-sqlite3 (compiled via node-pre-gyp on first install).
FROM node:20-alpine AS builder
WORKDIR /app

# Build tools required for better-sqlite3 native addon
RUN apk add --no-cache libc6-compat python3 make g++

COPY package*.json ./
# Full install (no --ignore-scripts) so better-sqlite3 compiles its native binding
RUN npm ci

COPY . .
# Ensure public/ exists even if the project has none (Docker COPY fails on missing dirs)
RUN mkdir -p public

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ─── Stage 2: Runner ─────────────────────────────────────────────────────────
# Minimal Alpine image — only the standalone server output is copied in.
# The compiled better-sqlite3 native module is included by Next.js standalone
# because it is listed in serverComponentsExternalPackages in next.config.ts.
FROM node:20-alpine AS runner
WORKDIR /app

# wget is used by the HEALTHCHECK command
RUN apk add --no-cache libc6-compat wget

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# ── Standalone build artifacts ───────────────────────────────────────────────
# .next/standalone/ includes server.js + all server-side node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets served directly by server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/static   ./.next/static
# Public directory (images, favicon, etc.)
COPY --from=builder --chown=nextjs:nodejs /app/public         ./public

# ── Data directory placeholders ──────────────────────────────────────────────
# These paths are overridden by volume mounts at runtime. Creating them here
# ensures the container can start even without volumes (useful for quick tests).
RUN mkdir -p /data/db /data/projects /data/logs /data/browser-profiles /data/downloads && \
    chown -R nextjs:nodejs /data

USER nextjs

EXPOSE 3000

# Health check: call the worker-status API that returns 200 when the app is up
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/worker/status > /dev/null || exit 1

CMD ["node", "server.js"]
