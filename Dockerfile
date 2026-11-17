# Multi-stage build: build React client, then run Node server
ARG NODE_VERSION=24-alpine

# 1) Build client
FROM node:${NODE_VERSION} AS client-builder
WORKDIR /app/client

# Install client deps
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Build client
# Bring client source
COPY client/ .
RUN npm run build

# 2) Build server
FROM node:${NODE_VERSION} AS server-builder
WORKDIR /app

# Install all deps (including devDependencies for TypeScript build)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy server code and shared modules
COPY server/ server/
COPY scraper/ scraper/
COPY filesystem/ filesystem/
COPY config/ config/
COPY types/ types/
COPY tsconfig.base.json tsconfig.build.json ./

# Build TypeScript
RUN npm run build:server

# 3) Server runtime
FROM node:${NODE_VERSION} AS server
ENV NODE_ENV=production
WORKDIR /app

# Install server deps (prod only)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy built server code from builder
COPY --from=server-builder /app/dist ./dist

# Bring in built client assets
COPY --from=client-builder /app/client/dist ./client/dist

# Create runtime write locations for the unprivileged user. Application code and
# dependencies remain root-owned because they only need to be read at runtime.
RUN mkdir -p /data /app/cover \
    && chown node:node /data /app/cover

ENV PORT=3000 \
    DATA_DIR=/data \
    COVER_DIR=/app/cover

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "const http = require('node:http'); const req = http.get({ hostname: '127.0.0.1', port: process.env.PORT || 3000, path: '/api/health', timeout: 3000 }, (res) => { res.resume(); process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('timeout', () => req.destroy()); req.on('error', () => process.exit(1));"]

USER node

CMD ["node", "dist/server/index.js"]
