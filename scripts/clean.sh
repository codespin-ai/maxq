#!/usr/bin/env bash
# -------------------------------------------------------------------
# clean.sh – clean build artifacts and node_modules
# -------------------------------------------------------------------
set -euo pipefail

# Change to the project root directory
cd "$(dirname "$0")/.."

echo "=== Cleaning MaxQ ==="

# Define packages
PACKAGES=(
  "maxq"
  "maxq-test-utils"
  "maxq-integration-tests"
)

# Clean dist directories
for pkg_name in "${PACKAGES[@]}"; do
  dist_dir="node/packages/$pkg_name/dist"
  if [[ -d "$dist_dir" ]]; then
    echo "Cleaning $dist_dir…"
    rm -rf "$dist_dir"
  fi
done

# Clean root node_modules
if [[ -d "node_modules" ]]; then
  echo "Cleaning root node_modules…"
  rm -rf node_modules
fi

# Clean node_modules from all packages
for pkg_name in "${PACKAGES[@]}"; do
  node_modules_dir="node/packages/$pkg_name/node_modules"
  if [[ -d "$node_modules_dir" ]]; then
    echo "Cleaning $node_modules_dir…"
    rm -rf "$node_modules_dir"
  fi
done

echo "=== Clean completed successfully ==="