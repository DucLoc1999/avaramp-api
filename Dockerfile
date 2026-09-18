# --- STAGE 1: Base Environment & Dependencies ---
FROM node:24-alpine AS base
RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package definitions first to lock the cache layer
COPY package.json package-lock.json ./

# Running clean install - This layer is cached UNLESS package.json/package-lock.json changes
RUN npm ci

# --- STAGE 2: Builder (TypeScript Compilation) ---
FROM base AS builder

# Copy source code after npm install to preserve cache on source changes
COPY . .

# Build TypeScript to dist/
RUN npm run build

# --- STAGE 3: Production Runtime ---
FROM node:24-alpine AS production
RUN apk update
RUN apk add --no-cache su-exec
WORKDIR /app

# Copy compiled dist and package files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Copy node_modules from base stage (cached if dependencies unchanged)
COPY --from=base /app/node_modules ./node_modules

# Production setup: migrations, logs, healthcheck
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/logs && \
    chown -R node:node /app/logs && \
    chmod -R 755 /app/logs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
