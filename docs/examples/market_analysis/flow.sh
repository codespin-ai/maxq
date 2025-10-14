#!/bin/bash
# MAXQ_SPEC_VERSION: 1.0
# Market Analysis Workflow
# Fetches news and prices, analyzes sentiment, calculates trends, generates report

set -e

# Source helper library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/helpers.sh"

# Validate dependencies
validate_required_commands

log_info "Market Analysis Flow - Stage: ${MAXQ_COMPLETED_STAGE:-initial}"

# Handle failures first - exit early if this is a failure callback
if [ -n "$MAXQ_FAILED_STAGE" ]; then
  log_error "Stage failed: $MAXQ_FAILED_STAGE"
  # Could implement recovery logic here
  # For now, just fail the run
  exit 1
fi

# Main flow logic based on completed stage
case "$MAXQ_COMPLETED_STAGE" in
  "")
    # Initial run - fetch data in parallel
    log_info "Scheduling data fetch stage"

    schedule_stage "data-fetch" "false" '[
      {
        "id": "fetch-news",
        "name": "fetch_news",
        "dependsOn": [],
        "maxRetries": 3,
        "env": {
          "SOURCE": "reuters",
          "MAX_ARTICLES": "50"
        }
      },
      {
        "id": "fetch-prices",
        "name": "fetch_prices",
        "dependsOn": [],
        "maxRetries": 3,
        "env": {
          "SYMBOL": "AAPL",
          "DAYS": "30"
        }
      }
    ]'
    ;;

  "data-fetch")
    # Data fetched - analyze in parallel
    # Flow generates 4 sentiment analyzer steps for parallel processing
    log_info "Data fetch complete, scheduling analysis stage"

    schedule_stage "analysis" "false" '[
      {
        "id": "sentiment-0",
        "name": "analyze_sentiment",
        "dependsOn": ["fetch-news"],
        "maxRetries": 2,
        "env": {
          "MODEL": "sentiment-v2",
          "BATCH_SIZE": "10",
          "SHARD": "0"
        }
      },
      {
        "id": "sentiment-1",
        "name": "analyze_sentiment",
        "dependsOn": ["fetch-news"],
        "maxRetries": 2,
        "env": {
          "MODEL": "sentiment-v2",
          "BATCH_SIZE": "10",
          "SHARD": "1"
        }
      },
      {
        "id": "sentiment-2",
        "name": "analyze_sentiment",
        "dependsOn": ["fetch-news"],
        "maxRetries": 2,
        "env": {
          "MODEL": "sentiment-v2",
          "BATCH_SIZE": "10",
          "SHARD": "2"
        }
      },
      {
        "id": "sentiment-3",
        "name": "analyze_sentiment",
        "dependsOn": ["fetch-news"],
        "maxRetries": 2,
        "env": {
          "MODEL": "sentiment-v2",
          "BATCH_SIZE": "10",
          "SHARD": "3"
        }
      },
      {
        "id": "calc-trends",
        "name": "calculate_trends",
        "dependsOn": ["fetch-prices"],
        "maxRetries": 2,
        "env": {
          "ALGORITHM": "moving-average"
        }
      }
    ]'
    ;;

  "analysis")
    # Analysis complete - generate final report
    log_info "Analysis complete, scheduling reporting stage"

    schedule_stage "reporting" "true" '[
      {
        "id": "report",
        "name": "generate_report",
        "dependsOn": ["sentiment-0", "sentiment-1", "sentiment-2", "sentiment-3", "calc-trends"],
        "maxRetries": 1,
        "env": {
          "FORMAT": "pdf",
          "RECIPIENTS": "team@example.com"
        }
      }
    ]'
    ;;

  *)
    log_error "Unknown stage completed: $MAXQ_COMPLETED_STAGE"
    exit 1
    ;;
esac

log_info "Flow scheduling complete"
exit 0
