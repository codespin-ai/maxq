#!/usr/bin/env bash
# -------------------------------------------------------------------
# lint-all.sh – run linting across all packages
# -------------------------------------------------------------------
set -euo pipefail

# Change to the project root directory
cd "$(dirname "$0")/.."

# Check for --fix flag
FIX_FLAG=""
LINT_COMMAND="lint"
if [[ "${1:-}" == "--fix" ]]; then
  FIX_FLAG="--fix"
  LINT_COMMAND="lint:fix"
  echo "Running linting with auto-fix across all packages..."
else
  echo "Running linting across all packages..."
fi

# Define packages
PACKAGES=(
  "maxq"
  "maxq-test-utils"
  "maxq-integration-tests"
)

# Track overall success
all_passed=true

# Lint each package
for pkg_name in "${PACKAGES[@]}"; do
  pkg="node/packages/$pkg_name"
  if [[ ! -f "$pkg/package.json" ]]; then
    continue
  fi
  
  # Check if lint script exists
  if node -e "process.exit(require('./$pkg/package.json').scripts?.lint ? 0 : 1)"; then
    echo ""
    echo "Linting @agilehead/$pkg_name..."
    # Try lint:fix first if --fix flag is set, otherwise use lint
    if [[ -n "$FIX_FLAG" ]]; then
      # Check if lint:fix script exists
      if node -e "process.exit(require('./$pkg/package.json').scripts?.['lint:fix'] ? 0 : 1)"; then
        if (cd "$pkg" && npm run lint:fix); then
          echo "✓ @agilehead/$pkg_name lint fixed"
        else
          echo "✗ @agilehead/$pkg_name lint:fix failed"
          all_passed=false
        fi
      else
        # Fall back to lint with --fix flag
        if (cd "$pkg" && npm run lint -- --fix); then
          echo "✓ @agilehead/$pkg_name lint fixed"
        else
          echo "✗ @agilehead/$pkg_name lint --fix failed"
          all_passed=false
        fi
      fi
    else
      if (cd "$pkg" && npm run lint); then
        echo "✓ @agilehead/$pkg_name lint passed"
      else
        echo "✗ @agilehead/$pkg_name lint failed"
        all_passed=false
      fi
    fi
  fi
done

echo ""
echo "================================"
if [ "$all_passed" = true ]; then
  if [[ -n "$FIX_FLAG" ]]; then
    echo "✓ All packages fixed successfully!"
  else
    echo "✓ All packages passed linting!"
  fi
  exit 0
else
  if [[ -n "$FIX_FLAG" ]]; then
    echo "✗ Some packages failed to fix"
  else
    echo "✗ Some packages failed linting"
  fi
  exit 1
fi