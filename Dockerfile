# Build stage
FROM node:24-alpine AS builder

# Install build dependencies (bash for scripts, python/make for native modules like better-sqlite3)
RUN apk add --no-cache bash python3 make g++

WORKDIR /app

# Copy root package files
COPY package*.json ./

# Copy maxq package files (only production package, not test packages)
COPY node/packages/maxq/package*.json ./node/packages/maxq/

# Copy TypeScript config
COPY tsconfig.base.json ./

# Install dependencies
RUN npm install --workspaces=false && \
    cd node/packages/maxq && npm install

# Copy maxq source code
COPY node/packages/maxq/src ./node/packages/maxq/src
COPY node/packages/maxq/migrations ./node/packages/maxq/migrations
COPY node/packages/maxq/tsconfig.json ./node/packages/maxq/

# Build maxq package
RUN cd node/packages/maxq && npm run build

# Runtime stage - Alpine for smaller image
FROM node:24-alpine AS runtime

# Install bash for shell scripts in flows
RUN apk add --no-cache bash

# Create non-root user
RUN addgroup -g 1001 -S maxq && \
    adduser -u 1001 -S maxq -G maxq

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=maxq:maxq /app/node/packages/maxq/dist ./dist
COPY --from=builder --chown=maxq:maxq /app/node/packages/maxq/migrations ./migrations
COPY --from=builder --chown=maxq:maxq /app/node/packages/maxq/package*.json ./
COPY --from=builder --chown=maxq:maxq /app/node/packages/maxq/node_modules ./node_modules

# Create directories for data and flows
RUN mkdir -p /app/data /app/flows && chown -R maxq:maxq /app/data /app/flows

# Switch to non-root user
USER maxq

# Expose REST API server port
EXPOSE 5003

# Set default environment variables
ENV NODE_ENV=production \
    MAXQ_SERVER_PORT=5003 \
    LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.MAXQ_SERVER_PORT || 5003) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Default command - run the CLI which handles migrations and starts server
CMD ["node", "dist/cli.js", "--data-dir", "/app/data", "--flows", "/app/flows"]
