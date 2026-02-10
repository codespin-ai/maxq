# MaxQ

A lightweight DAG-based workflow orchestration engine for shell-based workflows.

## Overview

MaxQ orchestrates multi-stage workflows using shell scripts and HTTP/JSON communication. Workflows are discovered from the filesystem, executed as processes, and coordinated through an SQLite-backed scheduler.

**Design Philosophy:**

- **Filesystem-Based**: Flows discovered from directory structure, not API registration
- **Language Agnostic**: Shell scripts can invoke any language or tool
- **Zero External Dependencies**: Embedded SQLite database, no external services required
- **HTTP Protocol**: All communication via REST API with JSON
- **Stateful**: SQLite is the source of truth for all state
- **DAG Execution**: Steps have dependencies and execute in topological order

## Core Concepts

### Flow

A workflow definition represented as an executable shell script (`flow.sh`) in the filesystem. Flows orchestrate stages and are called back when each stage completes.

### Run

A single execution instance of a flow. Created when a flow is triggered via API, tracked through pending → running → completed/failed states.

### Stage

A named batch of steps scheduled together by the flow (e.g., "data-fetch", "analysis"). Stages provide natural checkpoints and trigger flow callbacks when complete.

### Step

An individual unit of work within a stage. Steps are shell scripts that execute as processes, have dependencies (DAG), and post results via HTTP API.

## Prerequisites

- **Node.js** 18+
- **Bash** 4.0+
- Standard Unix utilities: `curl`, `jq`

### Environment Variables

```bash
# Required
MAXQ_FLOWS_ROOT=/path/to/flows          # Directory containing workflow definitions

# Optional
MAXQ_DATA_DIR=/path/to/data              # Data directory for SQLite database (default: ./data)
MAXQ_SERVER_PORT=5003                   # HTTP server port (default: 5003)
MAXQ_SCHEDULER_INTERVAL_MS=200          # Scheduler polling interval (default: 200ms)
MAXQ_SCHEDULER_BATCH_SIZE=10            # Steps per scheduler iteration (default: 10)
MAXQ_MAX_CONCURRENT_STEPS=10            # Max parallel step execution (default: 10)
LOG_LEVEL=info                          # Log level: debug, info, warn, error
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    MaxQ Server                      │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐   │
│  │   HTTP API  │  │  Scheduler   │  │  SQLite   │   │
│  │             │  │              │  │  Database │   │
│  └─────────────┘  └──────────────┘  └───────────┘   │
└─────────────────────────────────────────────────────┘
                         │
                         ├── Spawns: flow.sh processes
                         │
                         └── Spawns: step.sh processes
```

**Execution Flow:**

1. User triggers flow via `POST /api/v1/runs`
2. MaxQ creates run record and spawns `flow.sh` process
3. Flow schedules a stage by posting step definitions to API
4. Scheduler claims pending steps and spawns `step.sh` processes
5. Steps execute, post results via HTTP, exit with status code
6. When stage completes, MaxQ calls flow back with completed stage name
7. Flow schedules next stage or marks final stage
8. Run completes when final stage finishes

## Simple Example

### Directory Structure

```
FLOWS_ROOT/
└── hello_world/
    ├── flow.sh              # Flow orchestration
    └── steps/
        ├── greet/
        │   └── step.sh      # Step implementation
        └── farewell/
            └── step.sh
```

### flow.sh

```bash
#!/bin/bash
set -e

if [ -z "$MAXQ_COMPLETED_STAGE" ]; then
  # First call - schedule greeting stage
  curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
    -H "Content-Type: application/json" \
    -d '{
      "stage": "greeting",
      "final": false,
      "steps": [{
        "id": "greet-step",
        "name": "greet",
        "dependsOn": [],
        "maxRetries": 0
      }]
    }'

elif [ "$MAXQ_COMPLETED_STAGE" = "greeting" ]; then
  # Second call - schedule farewell stage
  curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
    -H "Content-Type: application/json" \
    -d '{
      "stage": "farewell",
      "final": true,
      "steps": [{
        "id": "farewell-step",
        "name": "farewell",
        "dependsOn": [],
        "maxRetries": 0
      }]
    }'
fi
```

### steps/greet/step.sh

```bash
#!/bin/bash
set -e

echo "Hello, World!"

# Post results via HTTP API
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps/$MAXQ_STEP_ID/fields" \
  -H "Content-Type: application/json" \
  -d '{"fields": {"message": "Hello, World!", "timestamp": '$(date +%s)'}}'

exit 0  # Exit code determines success/failure
```

### Trigger the Workflow

```bash
curl -X POST http://localhost:5003/api/v1/runs \
  -H "Content-Type: application/json" \
  -d '{"flowName": "hello_world"}'
```

## Quick Start

### Local Development

```bash
# Clone and build
git clone https://github.com/agilehead/maxq.git
cd maxq
./scripts/build.sh

# Start server (creates SQLite database automatically)
./scripts/start.sh
```

### Docker

```bash
# Build image
./scripts/docker-build.sh

# Run
docker run -p 5003:5003 \
  -v /path/to/flows:/app/flows \
  -v /path/to/data:/app/data \
  maxq:latest

# Test the image
./scripts/docker-test.sh
```

## Development Commands

```bash
./scripts/build.sh                  # Build all packages
./scripts/clean.sh                  # Remove build artifacts and node_modules
./scripts/lint-all.sh               # Run ESLint
./scripts/lint-all.sh --fix         # Run ESLint with auto-fix
./scripts/format-all.sh             # Format with Prettier
npm test                            # Run all tests
npm run test:grep -- "pattern"      # Search for specific tests
```

## Key Features

### Parallel Execution

Flows control parallelism by generating multiple step IDs with the same script name:

```json
{
  "steps": [
    { "id": "scraper-0", "name": "scraper", "env": { "SHARD": "0" } },
    { "id": "scraper-1", "name": "scraper", "env": { "SHARD": "1" } },
    { "id": "scraper-2", "name": "scraper", "env": { "SHARD": "2" } }
  ]
}
```

All three execute `steps/scraper/step.sh` with unique `MAXQ_STEP_ID` environment variables.

### DAG Dependencies

Steps specify dependencies using step IDs:

```json
{
  "steps": [
    { "id": "fetch-data", "name": "fetch", "dependsOn": [] },
    { "id": "process-1", "name": "process", "dependsOn": ["fetch-data"] },
    { "id": "process-2", "name": "process", "dependsOn": ["fetch-data"] }
  ]
}
```

The scheduler ensures `process-1` and `process-2` only execute after `fetch-data` completes.

### Data Passing Between Steps

Steps post arbitrary JSON data (fields) that downstream steps can query:

```bash
# Post results
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps/$MAXQ_STEP_ID/fields" \
  -d '{"fields": {"articles": [...], "count": 42}}'

# Query results
curl "$MAXQ_API/runs/$MAXQ_RUN_ID/fields?stepId=fetch-data"
```

### Scheduler-Driven Execution

Steps are queued and claimed by a background scheduler that:

- Polls for pending steps at configurable intervals
- Respects dependency ordering (DAG)
- Supports horizontal scaling with worker IDs
- Provides atomic step claiming to prevent double-execution

### Abort and Retry

```bash
# Abort running workflow
curl -X POST "$MAXQ_API/runs/$RUN_ID/abort"

# Retry failed or aborted workflow
curl -X POST "$MAXQ_API/runs/$RUN_ID/retry"
```

Retry resets incomplete work to pending and resumes execution.

## Documentation

- [Complete Specification](docs/specification.md) - HTTP API, database schema, workflow examples
- [Coding Standards](CODING-STANDARDS.md) - Development guidelines and patterns
- [Examples](docs/examples/) - Working example workflows
  - [Market Analysis](docs/examples/market_analysis/) - Multi-stage workflow with parallel processing

## HTTP API

Base URL: `http://localhost:5003/api/v1`

### Key Endpoints

```bash
# Trigger flow
POST /runs
Body: {"flowName": "my_flow"}

# Get run status
GET /runs/{runId}

# List runs
GET /runs?flowName={name}&status={status}

# Schedule stage (called by flow.sh)
POST /runs/{runId}/steps

# Post step results (called by step.sh)
POST /runs/{runId}/steps/{stepId}/fields

# Query step results
GET /runs/{runId}/fields?stepId={id}

# Abort run
POST /runs/{runId}/abort

# Retry run
POST /runs/{runId}/retry

# Create log entry
POST /runs/{runId}/logs

# List logs
GET /runs/{runId}/logs
```

See [docs/specification.md](docs/specification.md) for complete API documentation.

## Comparison to Other Systems

MaxQ differs from systems like Metaflow, Prefect, and Argo:

- **Language**: Shell scripts instead of Python decorators or YAML
- **Infrastructure**: Zero external dependencies (embedded SQLite)
- **Flow Definition**: Filesystem discovery instead of code registration
- **Orchestration**: Callback pattern with explicit stages
- **Execution**: Native processes instead of containers or Python functions

## License

MIT
