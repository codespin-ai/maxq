#!/bin/bash
# Analyze Sentiment Step
# Analyzes sentiment of news articles (runs in parallel with multiple sequences)

set -e

# Source helper library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../lib/helpers.sh"

validate_required_commands

log_info "Analyzing sentiment (sequence $MAXQ_STEP_SEQUENCE, model: $MODEL)"

# Fetch articles from previous step
log_info "Fetching articles from fetch_news step"
ARTICLES=$(get_artifact_value "fetch_news" "articles")

if [ "$ARTICLES" = "null" ] || [ -z "$ARTICLES" ]; then
  log_error "No articles found"
  exit 1
fi

# Each sequence processes a subset of articles
TOTAL_ARTICLES=$(echo "$ARTICLES" | jq 'length')
log_info "Total articles: $TOTAL_ARTICLES"

# Determine which articles this sequence should process
# Distribute articles round-robin across sequences
MY_ARTICLES=$(echo "$ARTICLES" | jq --argjson seq "$MAXQ_STEP_SEQUENCE" '[.[] | select((. | keys_unsorted | index("id")) and (.id | split("-")[1] | tonumber - 1) % 4 == $seq)]')

if [ "$MY_ARTICLES" = "[]" ] || [ -z "$MY_ARTICLES" ]; then
  log_info "No articles assigned to sequence $MAXQ_STEP_SEQUENCE"
  store_artifact "sentiments" "[]" '["sentiment", "analysis"]'
  exit 0
fi

ARTICLE_COUNT=$(echo "$MY_ARTICLES" | jq 'length')
log_info "Processing $ARTICLE_COUNT articles in sequence $MAXQ_STEP_SEQUENCE"

# Simulate sentiment analysis
# In real implementation, would call ML model
ANALYZED=$(echo "$MY_ARTICLES" | jq --arg seq "$MAXQ_STEP_SEQUENCE" '
  [.[] | {
    id: .id,
    title: .title,
    sentiment: (
      if (.title | contains("Rally") or contains("Surge") or contains("Launch")) then "positive"
      elif (.title | contains("Concern") or contains("Fear")) then "negative"
      else "neutral"
      end
    ),
    confidence: (0.7 + (now % 30) / 100),
    analyzedBy: ("sequence-" + $seq),
    analyzedAt: now
  }]
')

# Store sentiment results
log_info "Storing sentiment analysis for $ARTICLE_COUNT articles"
store_artifact "sentiments" "$ANALYZED" "[\"sentiment\", \"analysis\", \"sequence-$MAXQ_STEP_SEQUENCE\"]" "{\"model\": \"$MODEL\", \"articlesProcessed\": $ARTICLE_COUNT}"

# Calculate sentiment distribution
POSITIVE=$(echo "$ANALYZED" | jq '[.[] | select(.sentiment == "positive")] | length')
NEGATIVE=$(echo "$ANALYZED" | jq '[.[] | select(.sentiment == "negative")] | length')
NEUTRAL=$(echo "$ANALYZED" | jq '[.[] | select(.sentiment == "neutral")] | length')

SUMMARY=$(cat <<EOF
{
  "sequence": $MAXQ_STEP_SEQUENCE,
  "articlesProcessed": $ARTICLE_COUNT,
  "positive": $POSITIVE,
  "negative": $NEGATIVE,
  "neutral": $NEUTRAL,
  "overallTone": $([ $POSITIVE -gt $NEGATIVE ] && echo '"bullish"' || echo '"bearish"')
}
EOF
)

store_artifact "summary" "$SUMMARY" "[\"sentiment\", \"summary\"]"

log_info "Sentiment analysis complete: $POSITIVE positive, $NEGATIVE negative, $NEUTRAL neutral"
exit 0
