# MaxQ

DAG-based workflow orchestration engine with filesystem flow discovery and SQLite storage.

## Overview

MaxQ executes workflows defined as shell scripts organized in a filesystem hierarchy. Workflows consist of stages containing steps that can have dependencies, forming a Directed Acyclic Graph (DAG). The server spawns processes for flows and steps, managing execution state in SQLite.

Key characteristics:

- Filesystem-based flow discovery (no registration API)
- Stage-based orchestration with callbacks
- DAG execution with parallel step instances
- SQLite embedded database
- REST API for workflow management
- Process-based execution (spawns shell scripts)

## Installation

```bash
npm install -g maxq
```

Or run directly with npx:

```bash
npx maxq --port 5003 --data-dir ./data
```

## Quick Start

Start the MaxQ server:

```bash
maxq --port 5003 --data-dir ./data --flows ./flows
```

This starts the server on port 5003, stores data in `./data/maxq.db`, and discovers flows from `./flows`.

Create a simple flow at `./flows/hello/flow.sh`:

```bash
#!/bin/bash

# When MAXQ_COMPLETED_STAGE is empty, this is the initial call
if [ -z "$MAXQ_COMPLETED_STAGE" ]; then
  # Schedule the first stage
  cat <<EOF
{
  "stage": "greet",
  "steps": [
    {"name": "say-hello", "instances": 1}
  ]
}
EOF
  exit 0
fi

# Mark as final - no more stages
cat <<EOF
{
  "final": true
}
EOF
```

Create the step at `./flows/hello/steps/say-hello/step.sh`:

```bash
#!/bin/bash
echo "Hello from MaxQ"
```

Make scripts executable:

```bash
chmod +x ./flows/hello/flow.sh
chmod +x ./flows/hello/steps/say-hello/step.sh
```

Trigger the flow via HTTP:

```bash
curl -X POST http://localhost:5003/api/v1/runs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{"flowName": "hello"}'
```

## CLI Options

```
Usage: maxq [options]

Options:
  -p, --port <number>                 Server port (default: "5003")
  -d, --data-dir <path>               Data directory for SQLite database (default: "./data")
  -f, --flows <path>                  Flows root directory (default: "./flows")
  --max-concurrent-steps <number>     Maximum concurrent step execution (default: "10")
  --max-log-capture <number>          Maximum bytes of stdout/stderr to capture (default: "8192")
  --scheduler-interval <number>       Scheduler polling interval in milliseconds (default: "200")
  --scheduler-batch-size <number>     Steps per scheduler iteration (default: "10")
  --abort-grace-ms <number>           Grace period for aborting processes in milliseconds (default: "5000")
  --log-level <level>                 Log level (debug, info, warn, error) (default: "info")
  -V, --version                       output the version number
  -h, --help                          display help for command
```

## Flow Structure

Flows are discovered from the filesystem. No registration API exists.

### Directory Layout

```
flows/
└── <flow-name>/
    ├── flow.sh           # Flow orchestrator (required, must be executable)
    └── steps/
        └── <step-name>/
            └── step.sh   # Step script (required, must be executable)
```

### Flow Scripts

Flow scripts (`flow.sh`) are called with environment variables:

- `MAXQ_RUN_ID` - Unique run identifier
- `MAXQ_FLOW_NAME` - Flow name
- `MAXQ_API` - HTTP API base URL
- `MAXQ_COMPLETED_STAGE` - Name of last completed stage (empty on first call)
- `MAXQ_FAILED_STAGE` - Name of failed stage (if any)

Flow scripts return JSON to schedule stages:

```json
{
  "stage": "stage-name",
  "steps": [
    {
      "name": "step-name",
      "instances": 1,
      "dependsOn": [],
      "env": {},
      "maxRetries": 0
    }
  ],
  "final": false
}
```

When `final: true`, the flow completes and no callback occurs.

### Step Scripts

Step scripts (`step.sh`) are called with environment variables:

- `MAXQ_RUN_ID` - Run identifier
- `MAXQ_STEP_ID` - Step instance identifier
- `MAXQ_STEP_NAME` - Step name
- `MAXQ_STAGE_NAME` - Stage name
- `MAXQ_SEQUENCE` - Instance sequence number (0-indexed)
- `MAXQ_API` - HTTP API base URL
- Custom environment variables specified in step definition

Exit codes:

- `0` - Success
- Non-zero - Failure (triggers retry if maxRetries > 0)

## Stage-Based Orchestration

Workflows execute in stages. After each stage completes, the flow script is called back with `MAXQ_COMPLETED_STAGE` set to the completed stage name.

Example multi-stage flow:

```bash
#!/bin/bash

if [ -z "$MAXQ_COMPLETED_STAGE" ]; then
  # Initial call - schedule data fetch stage
  cat <<EOF
{
  "stage": "data-fetch",
  "steps": [
    {"name": "fetch-users", "instances": 1},
    {"name": "fetch-orders", "instances": 1}
  ]
}
EOF
  exit 0
fi

if [ "$MAXQ_COMPLETED_STAGE" = "data-fetch" ]; then
  # Data fetched - schedule analysis
  cat <<EOF
{
  "stage": "analysis",
  "steps": [
    {"name": "analyze-data", "instances": 1}
  ]
}
EOF
  exit 0
fi

if [ "$MAXQ_COMPLETED_STAGE" = "analysis" ]; then
  # Analysis done - final stage
  cat <<EOF
{
  "stage": "report",
  "steps": [
    {"name": "generate-report", "instances": 1}
  ],
  "final": true
}
EOF
  exit 0
fi
```

## DAG Execution

Steps within a stage can have dependencies, forming a DAG:

```json
{
  "stage": "processing",
  "steps": [
    { "name": "step-a", "instances": 1 },
    { "name": "step-b", "instances": 1, "dependsOn": ["step-a"] },
    { "name": "step-c", "instances": 1, "dependsOn": ["step-a"] },
    { "name": "step-d", "instances": 1, "dependsOn": ["step-b", "step-c"] }
  ]
}
```

Execution order:

1. `step-a` executes first
2. `step-b` and `step-c` execute in parallel after `step-a` completes
3. `step-d` executes after both `step-b` and `step-c` complete

## Parallel Execution

Steps can have multiple instances that execute in parallel:

```json
{
  "stage": "parallel-processing",
  "steps": [{ "name": "process-batch", "instances": 10 }]
}
```

This spawns 10 parallel instances of `process-batch`, each with a unique `MAXQ_SEQUENCE` (0-9) and `MAXQ_STEP_ID`.

## HTTP API

Base URL: `http://localhost:<port>/api/v1`

Authentication: Bearer token in `Authorization` header.

### Create Run

```
POST /api/v1/runs
Content-Type: application/json
Authorization: Bearer <token>

{
  "flowName": "string",
  "input": {},
  "metadata": {}
}
```

Response:

```json
{
  "id": "uuid",
  "flowName": "string",
  "status": "pending",
  "input": {},
  "metadata": {},
  "createdAt": 1234567890
}
```

### Get Run

```
GET /api/v1/runs/:id
```

### List Runs

```
GET /api/v1/runs?status=running&flowName=example&limit=10&offset=0
```

### Abort Run

```
POST /api/v1/runs/:runId/abort
```

Terminates all running processes for the run.

### Retry Run

```
POST /api/v1/runs/:runId/retry
```

Creates a new run with the same flow and input. Only allowed for failed or aborted runs.

### Pause Run

```
POST /api/v1/runs/:runId/pause
```

Pauses a pending or running run. Running steps complete, but no new steps are scheduled.

### Resume Run

```
POST /api/v1/runs/:runId/resume
```

Resumes a paused run.

### List Steps

```
GET /api/v1/runs/:runId/steps?status=completed&limit=10
```

### Retry Step

```
POST /api/v1/runs/:runId/steps/:stepId/retry?cascade=true
```

Retries a failed step. If `cascade=true`, resets dependent steps to pending.

### Create Log

```
POST /api/v1/runs/:runId/logs
Content-Type: application/json

{
  "level": "info",
  "message": "string",
  "entityType": "step",
  "entityId": "uuid",
  "metadata": {}
}
```

### Get Logs

```
GET /api/v1/runs/:runId/logs?level=error&entityType=step&limit=100
```

## Environment Variables

Configure the server via environment variables:

- `MAXQ_SERVER_PORT` - Server port (default: 5003)
- `MAXQ_DATA_DIR` - Data directory for SQLite database (default: `./data`)
- `MAXQ_FLOWS_ROOT` - Flows directory (default: `./flows`)
- `MAXQ_API_KEY` - Bearer token for authentication (default: `test-token`)
- `MAXQ_MAX_CONCURRENT_STEPS` - Max parallel step execution (default: 10)
- `MAXQ_MAX_LOG_CAPTURE` - Max bytes of stdout/stderr to capture (default: 8192)
- `MAXQ_SCHEDULER_INTERVAL_MS` - Scheduler polling interval (default: 200)
- `MAXQ_SCHEDULER_BATCH_SIZE` - Steps processed per iteration (default: 10)
- `MAXQ_ABORT_GRACE_MS` - Grace period for process termination (default: 5000)
- `LOG_LEVEL` - Log level: debug, info, warn, error (default: info)

## Example: Multi-Stage Pipeline

This example demonstrates a data processing pipeline with sequential stages.

### Flow: `./flows/data-pipeline/flow.sh`

```bash
#!/bin/bash

if [ -z "$MAXQ_COMPLETED_STAGE" ]; then
  # Stage 1: Fetch data from API
  cat <<EOF
{
  "stage": "fetch",
  "steps": [
    {"name": "fetch-data", "instances": 1}
  ]
}
EOF
  exit 0
fi

if [ "$MAXQ_COMPLETED_STAGE" = "fetch" ]; then
  # Stage 2: Process in parallel
  cat <<EOF
{
  "stage": "process",
  "steps": [
    {"name": "process-chunk", "instances": 5}
  ]
}
EOF
  exit 0
fi

if [ "$MAXQ_COMPLETED_STAGE" = "process" ]; then
  # Stage 3: Aggregate results
  cat <<EOF
{
  "stage": "aggregate",
  "steps": [
    {"name": "aggregate-results", "instances": 1}
  ],
  "final": true
}
EOF
  exit 0
fi
```

### Step: `./flows/data-pipeline/steps/fetch-data/step.sh`

```bash
#!/bin/bash

# Fetch data and store as artifact
DATA='{"records": [1,2,3,4,5]}'

curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MAXQ_API_KEY" \
  -d "{\"name\": \"data\", \"data\": $DATA}"
```

### Step: `./flows/data-pipeline/steps/process-chunk/step.sh`

```bash
#!/bin/bash

# Each instance processes one chunk
echo "Processing chunk $MAXQ_SEQUENCE"

# Store result
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MAXQ_API_KEY" \
  -d "{\"name\": \"chunk-$MAXQ_SEQUENCE\", \"data\": {\"result\": $MAXQ_SEQUENCE}}"
```

### Step: `./flows/data-pipeline/steps/aggregate-results/step.sh`

```bash
#!/bin/bash

# Fetch all chunk results
for i in {0..4}; do
  curl "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts/chunk-$i"
done

echo "Aggregation complete"
```

## Example: DAG with Dependencies

This example shows steps with dependencies executing in a DAG pattern.

### Flow: `./flows/dag-example/flow.sh`

```bash
#!/bin/bash

if [ -z "$MAXQ_COMPLETED_STAGE" ]; then
  cat <<EOF
{
  "stage": "process",
  "steps": [
    {"name": "fetch", "instances": 1},
    {"name": "transform-a", "instances": 1, "dependsOn": ["fetch"]},
    {"name": "transform-b", "instances": 1, "dependsOn": ["fetch"]},
    {"name": "merge", "instances": 1, "dependsOn": ["transform-a", "transform-b"]}
  ],
  "final": true
}
EOF
  exit 0
fi
```

Execution order:

1. `fetch` runs first
2. `transform-a` and `transform-b` run in parallel after `fetch`
3. `merge` runs after both transforms complete

## Error Handling

### Step Retries

Configure retries per step:

```json
{
  "name": "flaky-step",
  "instances": 1,
  "maxRetries": 3
}
```

If the step exits with non-zero code, it retries up to 3 times before marking as failed.

### Flow Failures

If a step fails after all retries:

- The stage is marked as failed
- The flow script is called with `MAXQ_FAILED_STAGE` set
- The run status becomes `failed`

Handle failures in the flow script:

```bash
#!/bin/bash

if [ -n "$MAXQ_FAILED_STAGE" ]; then
  echo "Stage $MAXQ_FAILED_STAGE failed"
  # Perform cleanup or error handling
  exit 1
fi
```

## Database Schema

MaxQ uses SQLite with the following main tables:

- `run` - Workflow execution instances
- `stage` - Stage execution records
- `step` - Step execution records with DAG dependencies
- `artifact` - Data produced by steps
- `run_log` - Log entries associated with runs

Database file location is configurable via `--data-dir` CLI option or `MAXQ_DATA_DIR` environment variable.

## Process Execution

MaxQ spawns processes using `child_process.spawn()`:

1. Validates script exists and is executable
2. Sets environment variables
3. Spawns process with inherited environment
4. Captures stdout/stderr (up to `MAXQ_MAX_LOG_CAPTURE` bytes)
5. Stores exit code and output in database

Security considerations:

- Scripts must be executable (checked before spawn)
- No shell interpolation (direct spawn, not via shell)
- Environment variable names are validated
- Path traversal prevention in flow/step resolution

## Scheduler

The scheduler runs at fixed intervals (`MAXQ_SCHEDULER_INTERVAL_MS`):

1. Queries for pending steps whose dependencies are completed
2. Claims steps for execution (up to `MAXQ_SCHEDULER_BATCH_SIZE`)
3. Spawns step processes
4. Updates step status based on exit codes
5. Triggers stage completion callbacks

Concurrency is limited by `MAXQ_MAX_CONCURRENT_STEPS`.

## License

MIT
