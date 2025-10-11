#!/bin/bash
# Generate Report Step
# Generates final market analysis report combining sentiment and trend data

set -e

# Source helper library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../lib/helpers.sh"

validate_required_commands

log_info "Generating market analysis report (format: $FORMAT)"

# Fetch sentiment analyses from all sequences
log_info "Fetching sentiment analyses"
SENTIMENT_ARTIFACTS=$(get_step_artifacts "analyze_sentiment")
ALL_SENTIMENTS=$(echo "$SENTIMENT_ARTIFACTS" | jq '[.artifacts[].value | select(. != null) | .[]]')

# Fetch trend analysis
log_info "Fetching trend analysis"
TREND_ANALYSIS=$(get_artifact_value "calculate_trends" "trend_analysis")
RECOMMENDATION=$(get_artifact_value "calculate_trends" "recommendation")

# Aggregate sentiment data
TOTAL_ARTICLES=$(echo "$ALL_SENTIMENTS" | jq 'length')
POSITIVE_COUNT=$(echo "$ALL_SENTIMENTS" | jq '[.[] | select(.sentiment == "positive")] | length')
NEGATIVE_COUNT=$(echo "$ALL_SENTIMENTS" | jq '[.[] | select(.sentiment == "negative")] | length')
NEUTRAL_COUNT=$(echo "$ALL_SENTIMENTS" | jq '[.[] | select(.sentiment == "neutral")] | length')

if [ "$TOTAL_ARTICLES" -gt 0 ]; then
  POSITIVE_PCT=$(echo "$POSITIVE_COUNT $TOTAL_ARTICLES" | awk '{printf "%.1f", ($1/$2)*100}')
  NEGATIVE_PCT=$(echo "$NEGATIVE_COUNT $TOTAL_ARTICLES" | awk '{printf "%.1f", ($1/$2)*100}')
  NEUTRAL_PCT=$(echo "$NEUTRAL_COUNT $TOTAL_ARTICLES" | awk '{printf "%.1f", ($1/$2)*100}')
else
  POSITIVE_PCT="0.0"
  NEGATIVE_PCT="0.0"
  NEUTRAL_PCT="0.0"
fi

# Determine overall sentiment
if [ "$POSITIVE_COUNT" -gt "$NEGATIVE_COUNT" ]; then
  OVERALL_SENTIMENT="bullish"
elif [ "$NEGATIVE_COUNT" -gt "$POSITIVE_COUNT" ]; then
  OVERALL_SENTIMENT="bearish"
else
  OVERALL_SENTIMENT="neutral"
fi

# Extract key metrics from trend analysis
SYMBOL=$(echo "$TREND_ANALYSIS" | jq -r '.symbol')
PRICE_CHANGE=$(echo "$TREND_ANALYSIS" | jq -r '.prices.change')
TREND=$(echo "$TREND_ANALYSIS" | jq -r '.trend')
SIGNAL=$(echo "$RECOMMENDATION" | jq -r '.signal')

# Generate report
REPORT=$(cat <<EOF
{
  "title": "Market Analysis Report",
  "symbol": "$SYMBOL",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "format": "$FORMAT",

  "executive_summary": {
    "recommendation": "$SIGNAL",
    "confidence": $(echo "$RECOMMENDATION" | jq '.confidence'),
    "overallSentiment": "$OVERALL_SENTIMENT",
    "priceTrend": "$TREND",
    "priceChange": "$PRICE_CHANGE"
  },

  "sentiment_analysis": {
    "totalArticles": $TOTAL_ARTICLES,
    "positive": {
      "count": $POSITIVE_COUNT,
      "percentage": "$POSITIVE_PCT%"
    },
    "negative": {
      "count": $NEGATIVE_COUNT,
      "percentage": "$NEGATIVE_PCT%"
    },
    "neutral": {
      "count": $NEUTRAL_COUNT,
      "percentage": "$NEUTRAL_PCT%"
    },
    "overall": "$OVERALL_SENTIMENT"
  },

  "technical_analysis": $(echo "$TREND_ANALYSIS" | jq '.'),

  "recommendation_details": $(echo "$RECOMMENDATION" | jq '.'),

  "top_articles": $(echo "$ALL_SENTIMENTS" | jq '[.[:5] | .[] | {title, sentiment, confidence}]'),

  "metadata": {
    "runId": "$MAXQ_RUN_ID",
    "flowName": "$MAXQ_FLOW_NAME",
    "recipients": "$RECIPIENTS"
  }
}
EOF
)

# Store the report
log_info "Storing market analysis report"
store_artifact "report" "$REPORT" '["report", "final"]' "{\"format\": \"$FORMAT\", \"recipients\": \"$RECIPIENTS\"}"

# Generate human-readable summary
SUMMARY=$(cat <<EOF
=================================================================
                  MARKET ANALYSIS REPORT
=================================================================

Symbol: $SYMBOL
Generated: $(date)
Recommendation: $SIGNAL ($(echo "$RECOMMENDATION" | jq -r '.confidence') confidence)

-----------------------------------------------------------------
EXECUTIVE SUMMARY
-----------------------------------------------------------------
Overall Sentiment: $OVERALL_SENTIMENT
Price Trend: $TREND ($PRICE_CHANGE)
Technical Signal: $SIGNAL

-----------------------------------------------------------------
SENTIMENT ANALYSIS ($TOTAL_ARTICLES articles analyzed)
-----------------------------------------------------------------
Positive: $POSITIVE_COUNT ($POSITIVE_PCT%)
Negative: $NEGATIVE_COUNT ($NEGATIVE_PCT%)
Neutral:  $NEUTRAL_COUNT ($NEUTRAL_PCT%)

-----------------------------------------------------------------
TECHNICAL ANALYSIS
-----------------------------------------------------------------
5-day SMA:  $(echo "$TREND_ANALYSIS" | jq -r '.movingAverages.sma5')
10-day SMA: $(echo "$TREND_ANALYSIS" | jq -r '.movingAverages.sma10')
Volatility: $(echo "$TREND_ANALYSIS" | jq -r '.volatility')

-----------------------------------------------------------------
RECOMMENDATION
-----------------------------------------------------------------
$(echo "$RECOMMENDATION" | jq -r '.reason')

=================================================================
EOF
)

# Store summary for easy viewing
store_artifact "summary" "$(echo "$SUMMARY" | jq -Rs .)" '["report", "summary"]'

# Print summary to logs
log_info "Report generated successfully"
echo "$SUMMARY"

# In a real implementation, would send email to RECIPIENTS
log_info "Report would be sent to: $RECIPIENTS"

exit 0
