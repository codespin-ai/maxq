#!/bin/bash
# Calculate Trends Step
# Calculates price trends and moving averages

set -e

# Source helper library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../lib/helpers.sh"

validate_required_commands

log_info "Calculating trends using $ALGORITHM algorithm"

# Fetch price data from previous step
log_info "Fetching price data from fetch_prices step"
PRICES=$(get_artifact_value "fetch_prices" "prices")

if [ "$PRICES" = "null" ] || [ -z "$PRICES" ]; then
  log_error "No price data found"
  exit 1
fi

SYMBOL=$(echo "$PRICES" | jq -r '.symbol')
PRICE_ARRAY=$(echo "$PRICES" | jq '.prices')
DAYS=$(echo "$PRICE_ARRAY" | jq 'length')

log_info "Analyzing $DAYS days of data for $SYMBOL"

# Calculate moving averages
# 5-day simple moving average
SMA_5=$(echo "$PRICE_ARRAY" | jq '[.[-5:] | .[].close] | add / length')
# 10-day simple moving average (or all days if less than 10)
SMA_10=$(echo "$PRICE_ARRAY" | jq 'if length >= 10 then [.[-10:] | .[].close] | add / length else [.[].close] | add / length end')

# Calculate price change
FIRST_CLOSE=$(echo "$PRICE_ARRAY" | jq '.[0].close')
LAST_CLOSE=$(echo "$PRICE_ARRAY" | jq '.[-1].close')
PRICE_CHANGE=$(echo "$FIRST_CLOSE $LAST_CLOSE" | awk '{printf "%.2f", (($2 - $1) / $1) * 100}')

# Determine trend direction
if (( $(echo "$SMA_5 > $SMA_10" | bc -l) )); then
  TREND="upward"
elif (( $(echo "$SMA_5 < $SMA_10" | bc -l) )); then
  TREND="downward"
else
  TREND="sideways"
fi

# Calculate volatility (simplified - standard deviation of closes)
MEAN=$(echo "$PRICE_ARRAY" | jq '[.[].close] | add / length')
VARIANCE=$(echo "$PRICE_ARRAY" | jq --argjson mean "$MEAN" '[.[].close] | map(. - $mean | . * .) | add / length')
VOLATILITY=$(echo "$VARIANCE" | awk '{printf "%.2f", sqrt($1)}')

# Create trend analysis
TREND_ANALYSIS=$(cat <<EOF
{
  "symbol": "$SYMBOL",
  "algorithm": "$ALGORITHM",
  "period": {
    "days": $DAYS,
    "from": $(echo "$PRICE_ARRAY" | jq '.[0].date'),
    "to": $(echo "$PRICE_ARRAY" | jq '.[-1].date')
  },
  "prices": {
    "first": $FIRST_CLOSE,
    "last": $LAST_CLOSE,
    "change": "$PRICE_CHANGE%"
  },
  "movingAverages": {
    "sma5": $SMA_5,
    "sma10": $SMA_10
  },
  "trend": "$TREND",
  "volatility": $VOLATILITY,
  "signal": $([ "$TREND" = "upward" ] && echo '"buy"' || echo '"hold"'),
  "analyzedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)

# Store trend analysis
log_info "Storing trend analysis"
store_artifact "trend_analysis" "$TREND_ANALYSIS" '["trends", "analysis"]' "{\"algorithm\": \"$ALGORITHM\"}"

# Store recommendation
RECOMMENDATION=$(cat <<EOF
{
  "symbol": "$SYMBOL",
  "trend": "$TREND",
  "priceChange": "$PRICE_CHANGE%",
  "signal": $([ "$TREND" = "upward" ] && echo '"buy"' || echo '"hold"'),
  "confidence": $(echo "$VOLATILITY" | awk '{if ($1 < 5) print "high"; else if ($1 < 10) print "medium"; else print "low"}' | jq -R .),
  "reason": $(echo "SMA5 ($SMA_5) vs SMA10 ($SMA_10) indicates $TREND trend" | jq -R .)
}
EOF
)

store_artifact "recommendation" "$RECOMMENDATION" '["trends", "recommendation"]'

log_info "Trend calculation complete: $TREND trend, $PRICE_CHANGE% change"
exit 0
