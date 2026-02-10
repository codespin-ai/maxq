#!/bin/bash

# Start script for MaxQ server
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if we're in Docker (scripts in /app/scripts)
if [ -f "/app/node/packages/maxq/dist/bin/server.js" ]; then
    cd /app/node/packages/maxq
elif [ -d "$SCRIPT_DIR/../node/packages/maxq" ]; then
    cd "$SCRIPT_DIR/../node/packages/maxq"
else
    echo "Error: Cannot find maxq package"
    exit 1
fi

# Start the server
node dist/bin/server.js
