#!/usr/bin/env bash
# -------------------------------------------------------------------
# db-all.sh - Run a database command on all databases
# Usage: ./scripts/db-all.sh [command]
# Example: ./scripts/db-all.sh migrate:latest
# -------------------------------------------------------------------
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 [command]"
  echo "Example: $0 migrate:latest"
  exit 1
fi

COMMAND=$1

# List of all databases
DATABASES=(
  "maxq"
)

echo "Running $COMMAND on all databases..."

for DB in "${DATABASES[@]}"; do
  echo ""
  echo "[$DB] Running $COMMAND..."
  npm run "${COMMAND//:/:$DB:}"
done

echo ""
echo "Completed $COMMAND on all databases."