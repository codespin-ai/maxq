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

# Main flow logic based on completed stage
case "$MAXQ_COMPLETED_STAGE" in
  "")
    # Initial run - fetch data in parallel
    log_info "Scheduling data fetch stage"

    schedule_stage "data-fetch" "false" '[
      {
        "name": "fetch_news",
        "dependsOn": [],
        "instances": 1,
        "maxRetries": 3,
        "env": {
          "SOURCE": "reuters",
          "MAX_ARTICLES": "50"
        }
      },
      {
        "name": "fetch_prices",
        "dependsOn": [],
        "instances": 1,
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
    log_info "Data fetch complete, scheduling analysis stage"

    schedule_stage "analysis" "false" '[
      {
        "name": "analyze_sentiment",
        "dependsOn": ["fetch_news"],
        "instances": 4,
        "maxRetries": 2,
        "env": {
          "MODEL": "sentiment-v2",
          "BATCH_SIZE": "10"
        }
      },
      {
        "name": "calculate_trends",
        "dependsOn": ["fetch_prices"],
        "instances": 1,
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
        "name": "generate_report",
        "dependsOn": ["analyze_sentiment", "calculate_trends"],
        "instances": 1,
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

# Handle failures
if [ -n "$MAXQ_FAILED_STAGE" ]; then
  log_error "Stage failed: $MAXQ_FAILED_STAGE"

  # Could implement recovery logic here
  # For now, just fail the run
  exit 1
fi

log_info "Flow scheduling complete"
exit 0
