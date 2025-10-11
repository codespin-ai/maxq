#!/usr/bin/env bash
# -------------------------------------------------------------------
# install-deps.sh – Install dependencies for all packages in the monorepo
#
# Usage:
#   ./scripts/install-deps.sh         # Install only if node_modules missing
#   ./scripts/install-deps.sh --force # Force reinstall all dependencies
# -------------------------------------------------------------------
set -euo pipefail

# Change to the project root directory
cd "$(dirname "$0")/.."

echo "=== Installing MaxQ Dependencies ==="

# Define the package order (same as build order)
PACKAGES=(
  "maxq-core"
  "maxq-logger"
  "maxq-db"
  "maxq-test-utils"
  "maxq-server"
  "maxq-client"
  "maxq-integration-tests"
)

# Install root deps (once)
if [[ ! -d node_modules || "$*" == *--force* ]]; then
  echo "Installing root dependencies…"
  npm install --legacy-peer-deps
fi

# Loop through every package in order
for pkg_name in "${PACKAGES[@]}"; do
  pkg="node/packages/$pkg_name"
  if [[ ! -d "$pkg" ]]; then
    echo "Package $pkg not found, skipping."
    continue
  fi
  if [[ ! -d "$pkg/node_modules" || "$*" == *--force* ]]; then
    echo "Installing deps in $pkg…"
    (cd "$pkg" && npm install --legacy-peer-deps)
  fi
done

echo "=== Dependency installation completed ==="
