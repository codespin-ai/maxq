#!/bin/bash
# Fetch News Step
# Fetches news articles from the specified source

set -e

# Source helper library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../lib/helpers.sh"

validate_required_commands

log_info "Fetching news from $SOURCE (max: $MAX_ARTICLES articles)"

# Simulate fetching news (in real implementation, would call actual API)
# For demo purposes, generate mock data
ARTICLES=$(cat <<EOF
[
  {
    "id": "article-1",
    "title": "Tech Stocks Rally on Strong Earnings",
    "content": "Major technology companies reported better-than-expected earnings...",
    "source": "$SOURCE",
    "publishedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "sentiment": null
  },
  {
    "id": "article-2",
    "title": "Market Concerns Over Economic Indicators",
    "content": "Recent economic data has raised concerns among investors...",
    "source": "$SOURCE",
    "publishedAt": "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)",
    "sentiment": null
  },
  {
    "id": "article-3",
    "title": "New Product Launch Drives Stock Surge",
    "content": "The announcement of a groundbreaking new product...",
    "source": "$SOURCE",
    "publishedAt": "$(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%SZ)",
    "sentiment": null
  }
]
EOF
)

# Store raw articles as artifact
log_info "Storing $(echo "$ARTICLES" | jq 'length') articles as artifact"

store_artifact "articles" "$ARTICLES" '["news", "raw"]' "{\"source\": \"$SOURCE\", \"fetchedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"

# Store metadata
METADATA=$(cat <<EOF
{
  "totalArticles": $(echo "$ARTICLES" | jq 'length'),
  "source": "$SOURCE",
  "fetchedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)

store_artifact "metadata" "$METADATA" '["metadata"]'

log_info "News fetch complete"
exit 0
