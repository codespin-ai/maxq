#!/bin/bash

# Docker entrypoint script for MaxQ
# Handles database setup and migrations before starting the server

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}MaxQ Docker Entrypoint${NC}"
echo "========================="

# Default to production environment
export NODE_ENV="${NODE_ENV:-production}"

# Check required environment variables
REQUIRED_VARS=(
    "FOREMAN_DB_HOST"
    "FOREMAN_DB_NAME"
    "JWT_SECRET"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}Error: Required environment variable $var is not set${NC}"
        exit 1
    fi
done

# Wait for database to be ready
echo -e "${YELLOW}Waiting for database to be ready...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if node -e "
        const pg = require('pg');
        const client = new pg.Client({
            host: process.env.FOREMAN_DB_HOST,
            port: process.env.FOREMAN_DB_PORT || 5432,
            database: process.env.FOREMAN_DB_NAME,
            user: process.env.UNRESTRICTED_DB_USER || process.env.FOREMAN_DB_USER,
            password: process.env.UNRESTRICTED_DB_USER_PASSWORD || process.env.FOREMAN_DB_PASSWORD
        });
        client.connect()
            .then(() => { client.end(); process.exit(0); })
            .catch(() => process.exit(1));
    " 2>/dev/null; then
        echo -e "${GREEN}Database is ready!${NC}"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo -e "${RED}Database connection failed after $MAX_RETRIES attempts${NC}"
        exit 1
    fi
    
    echo "Retrying in 2 seconds... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

# Run migrations if enabled (support both RUN_MIGRATIONS and FOREMAN_AUTO_MIGRATE)
if [ "${RUN_MIGRATIONS:-false}" = "true" ] || [ "${FOREMAN_AUTO_MIGRATE:-false}" = "true" ]; then
    echo -e "${YELLOW}Running database migrations...${NC}"
    npm run migrate:maxq:latest
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Migrations completed successfully${NC}"
    else
        echo -e "${RED}Migration failed${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Skipping migrations (FOREMAN_AUTO_MIGRATE != true)${NC}"
fi

# Execute the main command
echo -e "${GREEN}Starting MaxQ server...${NC}"
exec "$@"