#!/usr/bin/env bash
# -------------------------------------------------------------------
# start.sh – start the MaxQ server
# -------------------------------------------------------------------
set -euo pipefail

# Change to the project root directory
cd "$(dirname "$0")/.."

# Load environment variables if .env exists
if [[ -f .env ]]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Start the server
echo "Starting MaxQ server..."
cd node/packages/maxq-server
npm start