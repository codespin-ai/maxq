# Build stage
FROM node:24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache bash

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY node/package*.json ./node/
COPY node/packages/maxq-core/package*.json ./node/packages/maxq-core/
COPY node/packages/maxq-logger/package*.json ./node/packages/maxq-logger/
COPY node/packages/maxq-db/package*.json ./node/packages/maxq-db/
COPY node/packages/maxq-server/package*.json ./node/packages/maxq-server/

# Copy build scripts from scripts directory
COPY scripts/ ./scripts/

# Copy TypeScript config
COPY tsconfig.base.json ./

# Copy source code
COPY knexfile.js ./
COPY node ./node
COPY database ./database

# Install dependencies and build
RUN chmod +x scripts/build.sh scripts/clean.sh scripts/format-all.sh && \
    ./scripts/build.sh --install

# Runtime stage - Ubuntu minimal
FROM ubuntu:24.04 AS runtime

# Install Node.js 24 and minimal dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -r -u 1001 -g root -s /bin/bash maxq && \
    mkdir -p /home/maxq && \
    chown -R maxq:root /home/maxq

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=maxq:root /app/node ./node
COPY --from=builder --chown=maxq:root /app/database ./database
COPY --from=builder --chown=maxq:root /app/package*.json ./
COPY --from=builder --chown=maxq:root /app/node_modules ./node_modules
COPY --from=builder --chown=maxq:root /app/knexfile.js ./

# Copy start script and entrypoint
COPY --chown=maxq:root scripts/start.sh scripts/docker-entrypoint.sh ./
RUN chmod +x start.sh docker-entrypoint.sh

# Switch to non-root user
USER maxq

# Expose REST API server port
EXPOSE 5003

# Set default environment variables (non-sensitive only)
ENV NODE_ENV=production \
    MAXQ_SERVER_PORT=5003 \
    LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.MAXQ_SERVER_PORT || 5003) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Use entrypoint for automatic setup
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["./start.sh"]
