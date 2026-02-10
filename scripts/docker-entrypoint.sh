#!/bin/bash
set -e

echo "Starting MaxQ Workflow Engine..."

# Ensure data directory exists for SQLite
mkdir -p "${MAXQ_DATA_DIR:-/app/data}"

# Start the application
exec ./scripts/start.sh
