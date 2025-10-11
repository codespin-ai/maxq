#!/bin/bash
# Fetch Prices Step
# Fetches historical stock prices for the specified symbol

set -e

# Source helper library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../lib/helpers.sh"

validate_required_commands

log_info "Fetching price data for $SYMBOL (last $DAYS days)"

# Simulate fetching prices (in real implementation, would call actual API)
# Generate mock price data
PRICES=$(cat <<EOF
{
  "symbol": "$SYMBOL",
  "days": $DAYS,
  "prices": [
    {"date": "$(date -u -d '30 days ago' +%Y-%m-%d)", "open": 150.0, "close": 152.5, "high": 153.0, "low": 149.5, "volume": 100000000},
    {"date": "$(date -u -d '29 days ago' +%Y-%m-%d)", "open": 152.5, "close": 151.0, "high": 154.0, "low": 150.5, "volume": 95000000},
    {"date": "$(date -u -d '28 days ago' +%Y-%m-%d)", "open": 151.0, "close": 155.0, "high": 156.0, "low": 150.0, "volume": 110000000},
    {"date": "$(date -u -d '27 days ago' +%Y-%m-%d)", "open": 155.0, "close": 157.5, "high": 158.0, "low": 154.5, "volume": 105000000},
    {"date": "$(date -u -d '26 days ago' +%Y-%m-%d)", "open": 157.5, "close": 156.0, "high": 159.0, "low": 155.5, "volume": 98000000}
  ]
}
EOF
)

# Store price data
log_info "Storing price data for $SYMBOL"

store_artifact "prices" "$PRICES" '["prices", "raw"]' "{\"symbol\": \"$SYMBOL\", \"fetchedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"

# Calculate basic stats
AVG_CLOSE=$(echo "$PRICES" | jq '[.prices[].close] | add / length')
MIN_CLOSE=$(echo "$PRICES" | jq '[.prices[].close] | min')
MAX_CLOSE=$(echo "$PRICES" | jq '[.prices[].close] | max')

STATS=$(cat <<EOF
{
  "symbol": "$SYMBOL",
  "avgClose": $AVG_CLOSE,
  "minClose": $MIN_CLOSE,
  "maxClose": $MAX_CLOSE,
  "totalDays": $(echo "$PRICES" | jq '.prices | length')
}
EOF
)

store_artifact "price_stats" "$STATS" '["prices", "stats"]'

log_info "Price fetch complete - Avg: $AVG_CLOSE, Min: $MIN_CLOSE, Max: $MAX_CLOSE"
exit 0
