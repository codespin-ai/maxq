# Market Analysis Example

A complete MaxQ workflow that demonstrates:

- Parallel data fetching
- Multi-instance parallel processing (sentiment analysis)
- DAG dependencies
- Artifact storage and retrieval
- Stage-based orchestration

## Workflow Overview

This workflow analyzes stock market data by:

1. **Stage 1: Data Fetch** (parallel)
   - `fetch_news` - Fetches news articles
   - `fetch_prices` - Fetches historical stock prices

2. **Stage 2: Analysis** (parallel)
   - `analyze_sentiment` - Analyzes news sentiment (4 parallel instances)
   - `calculate_trends` - Calculates price trends and moving averages

3. **Stage 3: Reporting**
   - `generate_report` - Combines all analyses into a final report

## Directory Structure

```
market_analysis/
├── flow.sh                           # Flow orchestration
├── steps/
│   ├── fetch_news/
│   │   └── step.sh                   # Fetches news articles
│   ├── fetch_prices/
│   │   └── step.sh                   # Fetches price data
│   ├── analyze_sentiment/
│   │   └── step.sh                   # Analyzes sentiment (parallel)
│   ├── calculate_trends/
│   │   └── step.sh                   # Calculates price trends
│   └── generate_report/
│       └── step.sh                   # Generates final report
└── README.md                         # This file
```

## Dependencies

Each step requires:
- `bash` (4.0+)
- `curl` - For HTTP requests to MaxQ API
- `jq` - For JSON processing
- `bc` - For floating-point calculations (trends step)

## Running the Workflow

Assuming MaxQ is running at `http://localhost:3000`:

```bash
# Trigger the workflow
curl -X POST http://localhost:3000/api/v1/flows/market_analysis/runs \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "symbol": "AAPL",
      "reason": "Weekly analysis"
    },
    "metadata": {
      "user": "analyst",
      "team": "research"
    }
  }'
```

## Artifacts Produced

### Stage 1: Data Fetch

**fetch_news step:**
- `articles` - Array of news articles with title, content, source
- `metadata` - Fetch metadata (count, source, timestamp)

**fetch_prices step:**
- `prices` - Historical price data (open, close, high, low, volume)
- `price_stats` - Basic statistics (avg, min, max)

### Stage 2: Analysis

**analyze_sentiment step (4 instances, sequences 0-3):**
- `sentiments` - Array of analyzed articles with sentiment scores
- `summary` - Sentiment distribution summary per sequence

**calculate_trends step:**
- `trend_analysis` - Complete trend analysis (SMA, volatility, trend direction)
- `recommendation` - Trading recommendation with confidence

### Stage 3: Reporting

**generate_report step:**
- `report` - Complete JSON report combining all analyses
- `summary` - Human-readable text summary

## Example Output

The final report includes:

```json
{
  "title": "Market Analysis Report",
  "symbol": "AAPL",
  "executive_summary": {
    "recommendation": "buy",
    "confidence": "high",
    "overallSentiment": "bullish",
    "priceTrend": "upward",
    "priceChange": "+3.50%"
  },
  "sentiment_analysis": {
    "totalArticles": 3,
    "positive": { "count": 2, "percentage": "66.7%" },
    "negative": { "count": 1, "percentage": "33.3%" },
    "neutral": { "count": 0, "percentage": "0.0%" },
    "overall": "bullish"
  },
  "technical_analysis": {
    "movingAverages": { "sma5": 155.5, "sma10": 153.2 },
    "volatility": 2.34,
    "trend": "upward"
  }
}
```

## Customization

### Environment Variables

You can customize the workflow by modifying env vars in `flow.sh`:

```bash
# Data fetch stage
"SOURCE": "reuters"           # News source
"MAX_ARTICLES": "50"         # Max articles to fetch
"SYMBOL": "AAPL"             # Stock symbol
"DAYS": "30"                 # Days of price history

# Analysis stage
"MODEL": "sentiment-v2"      # Sentiment model
"BATCH_SIZE": "10"          # Articles per batch
"ALGORITHM": "moving-average" # Trend algorithm

# Reporting stage
"FORMAT": "pdf"              # Report format
"RECIPIENTS": "team@example.com" # Email recipients
```

### Parallel Processing

To change the number of parallel sentiment analyzers, edit `flow.sh`:

```bash
# Change from 4 to 8 instances
{
  "name": "analyze_sentiment",
  "instances": 8,  # <-- Change this
  ...
}
```

### Adding Steps

To add a new step:

1. Create directory: `steps/my_step/`
2. Create script: `steps/my_step/step.sh`
3. Make it executable
4. Add to flow.sh stage definition
5. Update dependencies (`dependsOn`)

## Notes

- This is a mock implementation using generated data
- Real implementation would call actual APIs (Reuters, Yahoo Finance, etc.)
- Sentiment analysis uses simple keyword matching (not ML)
- All steps use the `helpers.sh` library from `../lib/`
- Steps communicate via artifacts stored in MaxQ

## Monitoring

To check workflow status:

```bash
# Get run status
curl http://localhost:3000/api/v1/runs/{runId}

# List all steps
curl http://localhost:3000/api/v1/runs/{runId}/steps

# Get specific artifact
curl http://localhost:3000/api/v1/runs/{runId}/artifacts?stepName=generate_report&name=summary
```
