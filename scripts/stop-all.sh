#!/bin/bash

# Stop all MaxQ services (local processes and docker containers)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Stopping all MaxQ services..."

# Stop docker-compose services
echo "Stopping Docker Compose services..."
if [ -f "$ROOT_DIR/devenv/docker-compose.yml" ]; then
  docker compose -f "$ROOT_DIR/devenv/docker-compose.yml" down 2>/dev/null || true
fi

# Kill any local node processes related to maxq
echo "Stopping local Node.js processes..."
pkill -f "node.*maxq" 2>/dev/null || true

# Free up maxq port (5003) and test port (5099)
echo "Freeing ports 5003, 5099..."
for port in 5003 5099; do
  lsof -ti:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
done

# Wait for processes to terminate
sleep 2

echo "All MaxQ services stopped"
