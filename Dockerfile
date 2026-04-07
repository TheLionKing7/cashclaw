# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts vite.config.ts ./
COPY src ./src
COPY assets ./assets

# Build Node.js agent (tsup) + React UI (vite)
RUN npm run build:all

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compiled agent + UI
COPY --from=builder /app/dist ./dist

# Bundled moltlaunch CLI (marketplace stub)
COPY packages ./packages

# Make mltl available on PATH
RUN npm install -g /app/packages/mltl-cli

# Data dir — Fly.io volume will be mounted here at runtime.
# HOME=/data means os.homedir() returns /data, so:
#   ~/.fiveclaw  → /data/.fiveclaw  (agent config, logs, knowledge)
#   ~/.moltlaunch → /data/.moltlaunch (wallet, agent.json)
ENV HOME=/data
RUN mkdir -p /data

EXPOSE 3777

CMD ["node", "dist/index.js"]
