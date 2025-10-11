# MaxQ Specification

Version: 1.0
Last Updated: 2025-10-11

## Table of Contents

- [1. Introduction](#1-introduction)
- [2. Core Concepts](#2-core-concepts)
- [3. Architecture](#3-architecture)
- [4. Filesystem-Based Flow Discovery](#4-filesystem-based-flow-discovery)
- [5. Execution Model](#5-execution-model)
- [6. HTTP API Specification](#6-http-api-specification)
- [7. Environment Variables](#7-environment-variables)
- [8. Database Schema](#8-database-schema)
- [9. Workflow Examples](#9-workflow-examples)
- [10. Error Handling and Retries](#10-error-handling-and-retries)
- [11. Comparison to Other Systems](#11-comparison-to-other-systems)

---

## 1. Introduction

### 1.1 Overview

MaxQ is a lightweight DAG-based workflow orchestration engine designed for shell-based workflows with minimal infrastructure dependencies. Unlike Python-centric systems like Metaflow or Dagster, MaxQ uses shell scripts for both flow definitions and step implementations, communicating via HTTP/JSON.

### 1.2 Design Philosophy

- **Minimal Dependencies**: Only PostgreSQL required
- **Language Agnostic**: Flows and steps are shell scripts that can invoke any language
- **Filesystem-Based**: Flows discovered from directory structure, not API registration
- **HTTP Protocol**: All communication via REST API with JSON
- **Stateful**: PostgreSQL is the source of truth for all state
- **DAG Execution**: Steps have dependencies and execute in topological order
- **Callback Pattern**: Flows are called back when stages complete

### 1.3 Key Features

- DAG-based workflow execution
- Parallel step execution with sequence numbers
- Artifact storage for data passing between steps
- Stage-based orchestration with callback pattern
- Retry logic for failed steps
- Filesystem-based flow discovery
- Simple HTTP/JSON protocol

---

## 2. Core Concepts

### 2.1 Flow

A **flow** is a workflow definition represented as a shell script (`flow.sh`) in the filesystem.

**Characteristics:**

- Defined as an executable shell script
- Discovered from filesystem (not registered via API)
- Orchestrates workflow by scheduling stages
- Called back by MaxQ when stages complete
- Stateless - all state stored in MaxQ database

**Example:**

```
FLOWS_ROOT/market_analysis/flow.sh
```

### 2.2 Run

A **run** is a single execution instance of a flow.

**Characteristics:**

- Created when a flow is triggered
- Has a unique ID (UUID)
- Tracks overall workflow status: `pending`, `running`, `completed`, `failed`
- Multiple runs of the same flow can execute concurrently
- Contains metadata and execution history

**Lifecycle:**

1. Created in `pending` state
2. Transitions to `running` when flow.sh is first called
3. Ends in `completed` or `failed` state

### 2.3 Stage

A **stage** is a named batch of steps scheduled together by the flow.

**Characteristics:**

- Named by the flow (e.g., "data-fetch", "analysis", "reporting")
- Contains one or more steps
- Can be marked as `final` to indicate workflow completion
- Represents a logical phase in the workflow
- All steps in a stage must complete before flow is called back

**Purpose:**

- Groups related steps together
- Provides natural checkpoints in workflow execution
- Simplifies flow logic (flow reasons about stages, not individual steps)

### 2.4 Step

A **step** is an individual unit of work within a stage.

**Characteristics:**

- Defined as a shell script in `FLOWS_ROOT/{flow}/steps/{step_name}/step.sh`
- Has dependencies on other steps (DAG)
- Can have multiple instances (for parallel execution)
- Each instance has a sequence number (0, 1, 2, ...)
- Can retry on failure (configurable max retries)
- Produces artifacts for downstream consumption

**Status Values:**

- `pending`: Created but not yet executing
- `running`: Currently executing
- `completed`: Finished successfully
- `failed`: Execution failed after all retries
- `cancelled`: Manually cancelled

### 2.5 Sequence

A **sequence** number identifies parallel instances of the same step.

**Characteristics:**

- Integer starting from 0
- Assigned automatically by MaxQ when `instances > 1`
- Unique within a step name and run
- Used to namespace artifacts

**Example:**

```
instances: 4
→ Creates steps with sequences: 0, 1, 2, 3
```

### 2.6 Artifact

An **artifact** is data produced by a step and stored in MaxQ for downstream consumption.

**Characteristics:**

- Namespaced by step name and sequence: `step_name[sequence]/artifact_name`
- Stored as JSON in the database
- Queryable by downstream steps
- Immutable once created
- Supports tags for categorization

**Example:**

```
Step: process_page (sequence 0)
Artifact name: "page_data"
Full path: "process_page[0]/page_data"
```

---

## 3. Architecture

### 3.1 System Components

```
┌─────────────────────────────────────────────────────┐
│                    MaxQ Server                      │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │   HTTP API  │  │   Executor   │  │  Database │ │
│  │             │  │              │  │  Client   │ │
│  └─────────────┘  └──────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────┘
                         │
                         ├── PostgreSQL (state storage)
                         │
                         ├── Spawns: flow.sh processes
                         │
                         └── Spawns: step.sh processes
```

### 3.2 Communication Flow

1. **User triggers flow**: `POST /api/v1/flows/{flowName}/runs`
2. **MaxQ creates run**: Stores in database
3. **MaxQ spawns flow.sh**: With environment variables
4. **Flow schedules stage**: `POST /api/v1/runs/{runId}/steps`
5. **MaxQ spawns step.sh**: For each step (respecting dependencies)
6. **Steps execute**: Store artifacts via API
7. **Stage completes**: All steps in stage finish
8. **MaxQ calls flow.sh again**: With completed stage name
9. **Repeat 4-8**: Until flow marks a stage as `final`

### 3.3 Data Storage

- **PostgreSQL**: Single source of truth for all state
- **No Queue System**: MaxQ directly spawns processes
- **No External Storage**: Artifacts stored in database (JSON)

---

## 4. Filesystem-Based Flow Discovery

### 4.1 Directory Structure

MaxQ discovers flows from a root directory specified by the `MAXQ_FLOWS_ROOT` environment variable.

```
FLOWS_ROOT/
├── market_analysis/
│   ├── flow.sh              # Flow orchestration script
│   └── steps/
│       ├── fetch_news/
│       │   └── step.sh      # Step implementation
│       ├── fetch_prices/
│       │   └── step.sh
│       ├── analyze_sentiment/
│       │   └── step.sh
│       └── generate_report/
│           └── step.sh
│
└── data_pipeline/
    ├── flow.sh
    └── steps/
        ├── extract/
        │   └── step.sh
        ├── transform/
        │   └── step.sh
        └── load/
            └── step.sh
```

### 4.2 Discovery Rules

**Flow Discovery:**

- Each subdirectory under `FLOWS_ROOT` is a potential flow
- A directory is a valid flow if it contains `flow.sh`
- Flow name = directory name (e.g., `market_analysis`)
- `flow.sh` must be executable

**Step Discovery:**

- Steps are discovered under `{flow}/steps/` subdirectories
- Each subdirectory under `steps/` must contain `step.sh`
- Step name = subdirectory name (e.g., `fetch_news`)
- `step.sh` must be executable

**Validation on Startup:**
MaxQ validates on startup:

1. `FLOWS_ROOT` exists and is readable
2. Each flow has a valid `flow.sh`
3. Each step referenced in a stage exists
4. All scripts are executable

### 4.3 Step Resolution

When a flow schedules a step with name `fetch_news`, MaxQ resolves it to:

```
{FLOWS_ROOT}/{flowName}/steps/fetch_news/step.sh
```

**No `command` field needed** - MaxQ automatically resolves paths.

### 4.4 Hot Reload (Optional)

Implementations MAY support filesystem watching to detect:

- New flows added
- Flows removed
- Step scripts updated

Configure via: `MAXQ_WATCH_FLOWS=true`

---

## 5. Execution Model

### 5.1 Workflow Lifecycle

```
1. User triggers run → POST /api/v1/flows/{flowName}/runs

2. MaxQ creates run (status: pending)

3. MaxQ calls flow.sh (MAXQ_COMPLETED_STAGE="")
   ↓
   Flow schedules stage "data-fetch" (final: false)

4. MaxQ creates steps in database
   ↓
   MaxQ spawns step.sh processes (respecting dependencies)

5. Steps execute, store artifacts
   ↓
   All steps in "data-fetch" complete

6. MaxQ calls flow.sh (MAXQ_COMPLETED_STAGE="data-fetch")
   ↓
   Flow schedules stage "analysis" (final: false)

7. MaxQ spawns next batch of steps
   ↓
   Steps execute

8. All steps in "analysis" complete
   ↓
   MaxQ calls flow.sh (MAXQ_COMPLETED_STAGE="analysis")
   ↓
   Flow schedules stage "reporting" (final: true)

9. MaxQ spawns final steps
   ↓
   All steps in "reporting" complete

10. MaxQ marks run as completed (no more callbacks - final: true)
```

### 5.2 Stage Completion

A stage is considered complete when:

- ALL steps in the stage have status `completed`
- OR any step has status `failed` (stage fails)

When a stage completes:

- If `final: false`: MaxQ calls flow.sh with completed stage name
- If `final: true`: MaxQ marks run as completed, no callback

### 5.3 Step Execution

**Dependency Resolution:**

- MaxQ builds a DAG from `dependsOn` relationships
- Steps without dependencies start immediately
- Dependent steps wait for all dependencies to complete

**Parallel Execution:**

- Steps with no dependencies execute in parallel
- Steps with `instances > 1` execute in parallel (all sequences)

**Example:**

```json
{
  "steps": [
    { "name": "fetch_news", "dependsOn": [], "instances": 1 },
    { "name": "fetch_prices", "dependsOn": [], "instances": 1 },
    {
      "name": "analyze",
      "dependsOn": ["fetch_news", "fetch_prices"],
      "instances": 4
    }
  ]
}
```

Execution order:

1. `fetch_news` and `fetch_prices` start in parallel
2. When both complete, `analyze[0]`, `analyze[1]`, `analyze[2]`, `analyze[3]` start in parallel

### 5.4 Process Spawning

MaxQ spawns shell processes with:

- Working directory: `{FLOWS_ROOT}/{flowName}` for flows
- Working directory: `{FLOWS_ROOT}/{flowName}/steps/{stepName}` for steps
- Environment variables (see section 7)
- Standard input: closed
- Standard output: captured and logged
- Standard error: captured and logged

### 5.5 Exit Codes

**Flow exit codes:**

- `0`: Success (stage scheduled or workflow logic completed)
- `Non-zero`: Failure (MaxQ marks run as failed)

**Step exit codes:**

- `0`: Success (step completed)
- `Non-zero`: Failure (step failed, may retry)

---

## 6. HTTP API Specification

### 6.1 Base URL

```
http://{host}:{port}/api/v1
```

Default: `http://localhost:3000/api/v1`

### 6.2 Content Type

All requests and responses use `application/json`.

### 6.3 Authentication

Authentication is implementation-specific. The specification does not mandate a particular authentication mechanism.

---

### 6.4 Endpoints

#### 6.4.1 List Flows

```
GET /flows
```

Lists all discovered flows from the filesystem.

**Response:**

```json
{
  "flows": [
    {
      "name": "market_analysis",
      "path": "/flows/market_analysis",
      "steps": [
        "fetch_news",
        "fetch_prices",
        "analyze_sentiment",
        "generate_report"
      ]
    },
    {
      "name": "data_pipeline",
      "path": "/flows/data_pipeline",
      "steps": ["extract", "transform", "load"]
    }
  ]
}
```

---

#### 6.4.2 Trigger Flow

```
POST /flows/{flowName}/runs
```

Creates a new run for the specified flow.

**Request Body:**

```json
{
  "input": {
    "any": "json data"
  },
  "metadata": {
    "user": "alice",
    "reason": "scheduled job"
  }
}
```

**Response:** `201 Created`

```json
{
  "id": "run-uuid-123",
  "flowName": "market_analysis",
  "status": "pending",
  "input": { "any": "json data" },
  "metadata": { "user": "alice", "reason": "scheduled job" },
  "createdAt": 1704067200000,
  "startedAt": null,
  "completedAt": null
}
```

---

#### 6.4.3 Get Run

```
GET /runs/{runId}
```

Retrieves details about a specific run.

**Response:**

```json
{
  "id": "run-uuid-123",
  "flowName": "market_analysis",
  "status": "running",
  "input": { "any": "json data" },
  "output": null,
  "error": null,
  "metadata": { "user": "alice" },
  "createdAt": 1704067200000,
  "startedAt": 1704067201000,
  "completedAt": null,
  "stages": [
    {
      "name": "data-fetch",
      "status": "completed",
      "final": false,
      "createdAt": 1704067201000,
      "completedAt": 1704067210000
    },
    {
      "name": "analysis",
      "status": "running",
      "final": false,
      "createdAt": 1704067210000,
      "completedAt": null
    }
  ]
}
```

---

#### 6.4.4 List Runs

```
GET /runs?flowName={flowName}&status={status}&limit={limit}&offset={offset}
```

Lists runs with optional filtering.

**Query Parameters:**

- `flowName` (optional): Filter by flow name
- `status` (optional): Filter by status (`pending`, `running`, `completed`, `failed`)
- `limit` (optional): Max results (default: 20, max: 100)
- `offset` (optional): Pagination offset (default: 0)
- `sortBy` (optional): Sort field (default: `createdAt`)
- `sortOrder` (optional): `asc` or `desc` (default: `desc`)

**Response:**

```json
{
  "runs": [
    {
      "id": "run-uuid-123",
      "flowName": "market_analysis",
      "status": "completed",
      "createdAt": 1704067200000,
      "completedAt": 1704067300000
    }
  ],
  "pagination": {
    "total": 42,
    "limit": 20,
    "offset": 0
  }
}
```

---

#### 6.4.5 Schedule Stage

```
POST /runs/{runId}/steps
```

Called by flow.sh to schedule a stage with steps. This is the core API flows use to orchestrate work.

**Request Body:**

```json
{
  "stage": "data-fetch",
  "final": false,
  "steps": [
    {
      "name": "fetch_news",
      "dependsOn": [],
      "instances": 1,
      "maxRetries": 3,
      "env": {
        "SOURCE": "reuters",
        "API_KEY": "secret123"
      }
    },
    {
      "name": "fetch_prices",
      "dependsOn": [],
      "instances": 1,
      "maxRetries": 3,
      "env": {
        "SYMBOL": "AAPL"
      }
    }
  ]
}
```

**Field Descriptions:**

- `stage` (required, string): Name of this stage
- `final` (required, boolean): If true, no callback after this stage completes
- `steps` (required, array): Array of step definitions
  - `name` (required, string): Step name (must exist in filesystem)
  - `dependsOn` (optional, array): Array of step names this step depends on
  - `instances` (required, number): Number of parallel instances (1+)
  - `maxRetries` (required, number): Max retry attempts (0+)
  - `env` (optional, object): Environment variables passed to step.sh

**Response:** `201 Created`

```json
{
  "stage": "data-fetch",
  "scheduled": 2,
  "steps": [
    {
      "id": "step-uuid-1",
      "name": "fetch_news",
      "sequence": 0,
      "status": "pending"
    },
    {
      "id": "step-uuid-2",
      "name": "fetch_prices",
      "sequence": 0,
      "status": "pending"
    }
  ]
}
```

---

#### 6.4.6 Get Step

```
GET /steps/{stepId}
```

Retrieves details about a specific step.

**Response:**

```json
{
  "id": "step-uuid-1",
  "runId": "run-uuid-123",
  "stage": "data-fetch",
  "name": "fetch_news",
  "sequence": 0,
  "status": "completed",
  "dependsOn": [],
  "retryCount": 0,
  "maxRetries": 3,
  "env": {
    "SOURCE": "reuters"
  },
  "output": {
    "articles": 42
  },
  "error": null,
  "createdAt": 1704067201000,
  "startedAt": 1704067202000,
  "completedAt": 1704067210000,
  "durationMs": 8000
}
```

---

#### 6.4.7 List Steps

```
GET /runs/{runId}/steps?stage={stage}&status={status}&name={name}
```

Lists steps for a run with optional filtering.

**Query Parameters:**

- `stage` (optional): Filter by stage name
- `status` (optional): Filter by status
- `name` (optional): Filter by step name
- `sequence` (optional): Filter by sequence number
- `limit` (optional): Max results (default: 100)
- `offset` (optional): Pagination offset
- `sortBy` (optional): Sort field (default: `createdAt`)
- `sortOrder` (optional): `asc` or `desc` (default: `asc`)

**Response:**

```json
{
  "steps": [
    {
      "id": "step-uuid-1",
      "name": "fetch_news",
      "sequence": 0,
      "status": "completed",
      "stage": "data-fetch",
      "createdAt": 1704067201000,
      "completedAt": 1704067210000
    }
  ],
  "pagination": {
    "total": 10,
    "limit": 100,
    "offset": 0
  }
}
```

---

#### 6.4.8 Update Step Status

```
PATCH /steps/{stepId}
```

Called by MaxQ executor to update step status. May also be called by steps themselves to report progress.

**Request Body:**

```json
{
  "status": "completed",
  "output": {
    "articles": 42,
    "processed": true
  },
  "error": null
}
```

**Response:**

```json
{
  "id": "step-uuid-1",
  "status": "completed",
  "output": { "articles": 42, "processed": true },
  "completedAt": 1704067210000
}
```

---

#### 6.4.9 Store Artifact

```
POST /runs/{runId}/artifacts
```

Called by steps to store artifacts for downstream consumption.

**Request Body:**

```json
{
  "stepId": "step-uuid-1",
  "stepName": "fetch_news",
  "sequence": 0,
  "name": "raw_data",
  "value": {
    "articles": [{ "title": "Market Report", "content": "..." }]
  },
  "tags": ["news", "reuters"],
  "metadata": {
    "source": "reuters-api",
    "timestamp": 1704067210000
  }
}
```

**Field Descriptions:**

- `stepId` (required, string): ID of the step creating this artifact
- `stepName` (required, string): Name of the step
- `sequence` (required, number): Sequence number of the step instance
- `name` (required, string): Artifact name
- `value` (required, any): Artifact data (JSON)
- `tags` (optional, array): Tags for categorization
- `metadata` (optional, object): Additional metadata

**Response:** `201 Created`

```json
{
  "id": "artifact-uuid-1",
  "runId": "run-uuid-123",
  "stepName": "fetch_news",
  "sequence": 0,
  "name": "raw_data",
  "fullPath": "fetch_news[0]/raw_data",
  "value": { "articles": [...] },
  "tags": ["news", "reuters"],
  "metadata": { "source": "reuters-api" },
  "createdAt": 1704067210000
}
```

---

#### 6.4.10 Query Artifacts

```
GET /runs/{runId}/artifacts
```

Query artifacts with flexible filtering.

**Query Parameters:**

- `stepName` (optional): Filter by step name
- `sequence` (optional): Filter by sequence number
- `name` (optional): Filter by artifact name (exact match)
- `namePrefix` (optional): Filter by artifact name prefix
- `tags` (optional): Comma-separated tags (any match)
- `limit` (optional): Max results (default: 100)
- `offset` (optional): Pagination offset
- `sortBy` (optional): Sort field (default: `createdAt`)
- `sortOrder` (optional): `asc` or `desc` (default: `desc`)

**Response:**

```json
{
  "artifacts": [
    {
      "id": "artifact-uuid-1",
      "runId": "run-uuid-123",
      "stepName": "fetch_news",
      "sequence": 0,
      "name": "raw_data",
      "fullPath": "fetch_news[0]/raw_data",
      "value": { "articles": [...] },
      "tags": ["news", "reuters"],
      "createdAt": 1704067210000
    },
    {
      "id": "artifact-uuid-2",
      "stepName": "process_page",
      "sequence": 0,
      "name": "page_data",
      "fullPath": "process_page[0]/page_data",
      "value": { "processed": true },
      "tags": ["processed"],
      "createdAt": 1704067220000
    }
  ],
  "pagination": {
    "total": 15,
    "limit": 100,
    "offset": 0
  }
}
```

**Example Queries:**

```bash
# Get all artifacts from fetch_news step
GET /runs/{runId}/artifacts?stepName=fetch_news

# Get artifacts from process_page sequence 2
GET /runs/{runId}/artifacts?stepName=process_page&sequence=2

# Get all "page_data" artifacts across all sequences
GET /runs/{runId}/artifacts?name=page_data

# Get artifacts with specific tags
GET /runs/{runId}/artifacts?tags=processed,validated
```

---

#### 6.4.11 Get Artifact

```
GET /runs/{runId}/artifacts/{artifactId}
```

Retrieves a specific artifact by ID.

**Response:**

```json
{
  "id": "artifact-uuid-1",
  "runId": "run-uuid-123",
  "stepName": "fetch_news",
  "sequence": 0,
  "name": "raw_data",
  "fullPath": "fetch_news[0]/raw_data",
  "value": { "articles": [...] },
  "tags": ["news", "reuters"],
  "metadata": { "source": "reuters-api" },
  "createdAt": 1704067210000
}
```

---

### 6.5 Error Responses

All errors follow this format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

**HTTP Status Codes:**

- `400 Bad Request`: Invalid input
- `404 Not Found`: Resource not found
- `409 Conflict`: State conflict (e.g., stage already scheduled)
- `500 Internal Server Error`: Server error

---

## 7. Environment Variables

### 7.1 MaxQ Configuration

Environment variables for MaxQ server:

```bash
# Required
MAXQ_FLOWS_ROOT=/path/to/flows        # Root directory for flow discovery
MAXQ_DATABASE_URL=postgresql://...    # PostgreSQL connection string

# Optional
MAXQ_HOST=0.0.0.0                     # HTTP server host (default: 0.0.0.0)
MAXQ_PORT=3000                        # HTTP server port (default: 3000)
MAXQ_WATCH_FLOWS=false                # Watch filesystem for changes (default: false)
MAXQ_LOG_LEVEL=info                   # Logging level (default: info)
MAXQ_MAX_CONCURRENT_STEPS=10          # Max parallel step executions (default: 10)
```

### 7.2 Flow Environment Variables

When MaxQ spawns `flow.sh`, it provides these environment variables:

```bash
# Required
MAXQ_RUN_ID=run-uuid-123              # Unique run identifier
MAXQ_FLOW_NAME=market_analysis        # Name of the flow
MAXQ_API=http://localhost:3000/api/v1 # MaxQ API base URL
MAXQ_COMPLETED_STAGE=data-fetch       # Last completed stage (empty on first call)

# Optional (present if applicable)
MAXQ_FAILED_STAGE=analysis            # Name of failed stage (if any)
```

**First Call:**

```bash
MAXQ_RUN_ID=run-uuid-123
MAXQ_FLOW_NAME=market_analysis
MAXQ_API=http://localhost:3000/api/v1
MAXQ_COMPLETED_STAGE=""               # Empty - no stages completed yet
```

**Subsequent Calls:**

```bash
MAXQ_RUN_ID=run-uuid-123
MAXQ_FLOW_NAME=market_analysis
MAXQ_API=http://localhost:3000/api/v1
MAXQ_COMPLETED_STAGE=data-fetch       # Just completed stage
```

### 7.3 Step Environment Variables

When MaxQ spawns `step.sh`, it provides these environment variables:

```bash
# Required
MAXQ_RUN_ID=run-uuid-123              # Run identifier
MAXQ_STEP_ID=step-uuid-456            # Unique step identifier
MAXQ_STEP_NAME=fetch_news             # Step name
MAXQ_STEP_SEQUENCE=0                  # Sequence number for this instance
MAXQ_FLOW_NAME=market_analysis        # Name of the flow
MAXQ_STAGE=data-fetch                 # Stage this step belongs to
MAXQ_API=http://localhost:3000/api/v1 # MaxQ API base URL

# Custom (from step definition)
SOURCE=reuters                        # User-defined env vars
API_KEY=secret123                     # from "env" field in stage scheduling
```

**Example for parallel instance:**

```bash
# Instance 0
MAXQ_STEP_SEQUENCE=0

# Instance 1
MAXQ_STEP_SEQUENCE=1

# Instance 2
MAXQ_STEP_SEQUENCE=2
```

---

## 8. Database Schema

This section describes the logical schema. Implementations may vary in specific types (e.g., UUID vs string, timestamp precision).

### 8.1 `run` Table

Stores run instances.

```sql
CREATE TABLE run (
  id                TEXT PRIMARY KEY,        -- UUID
  flow_name         TEXT NOT NULL,           -- Flow name
  status            TEXT NOT NULL,           -- pending, running, completed, failed
  input             JSONB,                   -- Input data provided at trigger
  output            JSONB,                   -- Final output (if any)
  error             JSONB,                   -- Error details (if failed)
  metadata          JSONB,                   -- User-provided metadata
  created_at        BIGINT NOT NULL,         -- Epoch milliseconds
  started_at        BIGINT,                  -- When first stage scheduled
  completed_at      BIGINT,                  -- When run finished
  duration_ms       BIGINT                   -- Total duration
);

CREATE INDEX idx_run_flow_name ON run(flow_name);
CREATE INDEX idx_run_status ON run(status);
CREATE INDEX idx_run_created_at ON run(created_at DESC);
```

### 8.2 `stage` Table

Stores stage definitions and completion status.

```sql
CREATE TABLE stage (
  id                TEXT PRIMARY KEY,        -- UUID
  run_id            TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,           -- Stage name (e.g., "data-fetch")
  final             BOOLEAN NOT NULL,        -- Is this the final stage?
  status            TEXT NOT NULL,           -- pending, running, completed, failed
  created_at        BIGINT NOT NULL,
  completed_at      BIGINT
);

CREATE INDEX idx_stage_run_id ON stage(run_id);
CREATE INDEX idx_stage_name ON stage(run_id, name);
CREATE UNIQUE INDEX idx_stage_run_name ON stage(run_id, name);
```

### 8.3 `step` Table

Stores individual step instances.

```sql
CREATE TABLE step (
  id                TEXT PRIMARY KEY,        -- UUID
  run_id            TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  stage_id          TEXT NOT NULL REFERENCES stage(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,           -- Step name
  sequence          INTEGER NOT NULL,        -- Instance sequence (0, 1, 2, ...)
  status            TEXT NOT NULL,           -- pending, running, completed, failed, cancelled
  depends_on        JSONB NOT NULL,          -- Array of step names: ["step1", "step2"]
  retry_count       INTEGER NOT NULL DEFAULT 0,
  max_retries       INTEGER NOT NULL,
  env               JSONB,                   -- Environment variables
  output            JSONB,                   -- Step output data
  error             JSONB,                   -- Error details
  created_at        BIGINT NOT NULL,
  started_at        BIGINT,
  completed_at      BIGINT,
  duration_ms       BIGINT
);

CREATE INDEX idx_step_run_id ON step(run_id);
CREATE INDEX idx_step_stage_id ON step(stage_id);
CREATE INDEX idx_step_status ON step(status);
CREATE INDEX idx_step_name ON step(run_id, name);
CREATE UNIQUE INDEX idx_step_run_name_seq ON step(run_id, name, sequence);
```

### 8.4 `artifact` Table

Stores artifacts produced by steps.

```sql
CREATE TABLE artifact (
  id                TEXT PRIMARY KEY,        -- UUID
  run_id            TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  step_id           TEXT NOT NULL REFERENCES step(id) ON DELETE CASCADE,
  step_name         TEXT NOT NULL,           -- Denormalized for queries
  sequence          INTEGER NOT NULL,        -- Denormalized for queries
  name              TEXT NOT NULL,           -- Artifact name
  full_path         TEXT NOT NULL,           -- step_name[sequence]/name
  value             JSONB NOT NULL,          -- Artifact data
  tags              TEXT[],                  -- Tags for filtering
  metadata          JSONB,                   -- Additional metadata
  created_at        BIGINT NOT NULL
);

CREATE INDEX idx_artifact_run_id ON artifact(run_id);
CREATE INDEX idx_artifact_step_id ON artifact(step_id);
CREATE INDEX idx_artifact_step_name ON artifact(run_id, step_name);
CREATE INDEX idx_artifact_name ON artifact(run_id, name);
CREATE INDEX idx_artifact_full_path ON artifact(run_id, full_path);
CREATE INDEX idx_artifact_tags ON artifact USING GIN(tags);
CREATE INDEX idx_artifact_created_at ON artifact(created_at DESC);
```

### 8.5 `log` Table (Optional)

Stores execution logs.

```sql
CREATE TABLE log (
  id                TEXT PRIMARY KEY,        -- UUID
  run_id            TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  step_id           TEXT REFERENCES step(id) ON DELETE CASCADE,
  level             TEXT NOT NULL,           -- info, warn, error, debug
  message           TEXT NOT NULL,
  data              JSONB,
  created_at        BIGINT NOT NULL
);

CREATE INDEX idx_log_run_id ON log(run_id);
CREATE INDEX idx_log_step_id ON log(step_id);
CREATE INDEX idx_log_created_at ON log(created_at DESC);
```

---

## 9. Workflow Examples

### 9.1 Simple Sequential Workflow

**Directory Structure:**

```
FLOWS_ROOT/
└── hello_world/
    ├── flow.sh
    └── steps/
        ├── greet/
        │   └── step.sh
        └── goodbye/
            └── step.sh
```

**flow.sh:**

```bash
#!/bin/bash
set -e

schedule_stage() {
  curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
    -H "Content-Type: application/json" \
    -d "$1"
}

if [ -z "$MAXQ_COMPLETED_STAGE" ]; then
  # First run - say hello
  schedule_stage '{
    "stage": "greeting",
    "final": false,
    "steps": [
      {
        "name": "greet",
        "dependsOn": [],
        "instances": 1,
        "maxRetries": 0,
        "env": { "NAME": "World" }
      }
    ]
  }'

elif [ "$MAXQ_COMPLETED_STAGE" = "greeting" ]; then
  # Say goodbye
  schedule_stage '{
    "stage": "farewell",
    "final": true,
    "steps": [
      {
        "name": "goodbye",
        "dependsOn": ["greet"],
        "instances": 1,
        "maxRetries": 0,
        "env": {}
      }
    ]
  }'
fi
```

**steps/greet/step.sh:**

```bash
#!/bin/bash
set -e

echo "Hello, $NAME!"

# Store artifact
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts" \
  -H "Content-Type: application/json" \
  -d "{
    \"stepId\": \"$MAXQ_STEP_ID\",
    \"stepName\": \"$MAXQ_STEP_NAME\",
    \"sequence\": $MAXQ_STEP_SEQUENCE,
    \"name\": \"greeting\",
    \"value\": { \"message\": \"Hello, $NAME!\" }
  }"
```

**steps/goodbye/step.sh:**

```bash
#!/bin/bash
set -e

# Fetch greeting artifact
GREETING=$(curl "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts?stepName=greet&name=greeting" | \
  jq -r '.artifacts[0].value.message')

echo "Previous greeting was: $GREETING"
echo "Goodbye!"
```

---

### 9.2 Parallel Processing Workflow

**Directory Structure:**

```
FLOWS_ROOT/
└── web_scraper/
    ├── flow.sh
    └── steps/
        ├── fetch_urls/
        │   └── step.sh
        ├── scrape_page/
        │   └── step.sh
        └── aggregate/
            └── step.sh
```

**flow.sh:**

```bash
#!/bin/bash
set -e

if [ -z "$MAXQ_COMPLETED_STAGE" ]; then
  # Stage 1: Fetch list of URLs
  curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
    -H "Content-Type: application/json" \
    -d '{
      "stage": "fetch",
      "final": false,
      "steps": [{
        "name": "fetch_urls",
        "dependsOn": [],
        "instances": 1,
        "maxRetries": 3,
        "env": { "SOURCE": "https://example.com/sitemap.xml" }
      }]
    }'

elif [ "$MAXQ_COMPLETED_STAGE" = "fetch" ]; then
  # Stage 2: Scrape 10 pages in parallel
  curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
    -H "Content-Type: application/json" \
    -d '{
      "stage": "scrape",
      "final": false,
      "steps": [{
        "name": "scrape_page",
        "dependsOn": ["fetch_urls"],
        "instances": 10,
        "maxRetries": 2,
        "env": { "TIMEOUT": "30" }
      }]
    }'

elif [ "$MAXQ_COMPLETED_STAGE" = "scrape" ]; then
  # Stage 3: Aggregate results
  curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
    -H "Content-Type: application/json" \
    -d '{
      "stage": "aggregate",
      "final": true,
      "steps": [{
        "name": "aggregate",
        "dependsOn": ["scrape_page"],
        "instances": 1,
        "maxRetries": 1,
        "env": {}
      }]
    }'
fi
```

**steps/fetch_urls/step.sh:**

```bash
#!/bin/bash
set -e

# Fetch sitemap and extract URLs
URLS=$(curl "$SOURCE" | grep -oP 'https://[^<]+' | head -10)

# Store as artifact
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts" \
  -H "Content-Type: application/json" \
  -d "{
    \"stepId\": \"$MAXQ_STEP_ID\",
    \"stepName\": \"$MAXQ_STEP_NAME\",
    \"sequence\": $MAXQ_STEP_SEQUENCE,
    \"name\": \"urls\",
    \"value\": $(echo "$URLS" | jq -R -s -c 'split("\n") | map(select(length > 0))')
  }"
```

**steps/scrape_page/step.sh:**

```bash
#!/bin/bash
set -e

# Get URLs from previous step
URLS=$(curl "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts?stepName=fetch_urls&name=urls" | \
  jq -r '.artifacts[0].value')

# Each instance processes one URL
URL=$(echo "$URLS" | jq -r ".[$MAXQ_STEP_SEQUENCE]")

echo "Scraping: $URL"
CONTENT=$(curl -s "$URL" | html2text)

# Store scraped content
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts" \
  -H "Content-Type: application/json" \
  -d "{
    \"stepId\": \"$MAXQ_STEP_ID\",
    \"stepName\": \"$MAXQ_STEP_NAME\",
    \"sequence\": $MAXQ_STEP_SEQUENCE,
    \"name\": \"page_content\",
    \"value\": { \"url\": \"$URL\", \"content\": $(echo "$CONTENT" | jq -R -s) },
    \"tags\": [\"scraped\"]
  }"
```

**steps/aggregate/step.sh:**

```bash
#!/bin/bash
set -e

# Fetch all scraped pages
PAGES=$(curl "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts?stepName=scrape_page&name=page_content")

# Aggregate and count
TOTAL=$(echo "$PAGES" | jq '.artifacts | length')
echo "Scraped $TOTAL pages"

# Store summary
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/artifacts" \
  -H "Content-Type: application/json" \
  -d "{
    \"stepId\": \"$MAXQ_STEP_ID\",
    \"stepName\": \"$MAXQ_STEP_NAME\",
    \"sequence\": $MAXQ_STEP_SEQUENCE,
    \"name\": \"summary\",
    \"value\": { \"totalPages\": $TOTAL }
  }"
```

---

### 9.3 Complex DAG Workflow

**Directory Structure:**

```
FLOWS_ROOT/
└── market_analysis/
    ├── flow.sh
    └── steps/
        ├── fetch_news/
        │   └── step.sh
        ├── fetch_prices/
        │   └── step.sh
        ├── analyze_sentiment/
        │   └── step.sh
        ├── calculate_trends/
        │   └── step.sh
        └── generate_report/
            └── step.sh
```

**flow.sh:**

```bash
#!/bin/bash
set -e

schedule_stage() {
  local stage_name="$1"
  local is_final="$2"
  local steps_json="$3"

  curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
    -H "Content-Type: application/json" \
    -d "{
      \"stage\": \"$stage_name\",
      \"final\": $is_final,
      \"steps\": $steps_json
    }"
}

case "$MAXQ_COMPLETED_STAGE" in
  "")
    # Stage 1: Fetch data in parallel
    schedule_stage "data-fetch" "false" '[
      {
        "name": "fetch_news",
        "dependsOn": [],
        "instances": 1,
        "maxRetries": 3,
        "env": { "SOURCE": "reuters" }
      },
      {
        "name": "fetch_prices",
        "dependsOn": [],
        "instances": 1,
        "maxRetries": 3,
        "env": { "SYMBOL": "AAPL" }
      }
    ]'
    ;;

  "data-fetch")
    # Stage 2: Analyze data (4 parallel sentiment analyzers)
    schedule_stage "analysis" "false" '[
      {
        "name": "analyze_sentiment",
        "dependsOn": ["fetch_news"],
        "instances": 4,
        "maxRetries": 2,
        "env": { "MODEL": "sentiment-v2" }
      },
      {
        "name": "calculate_trends",
        "dependsOn": ["fetch_prices"],
        "instances": 1,
        "maxRetries": 2,
        "env": {}
      }
    ]'
    ;;

  "analysis")
    # Stage 3: Generate report (depends on both analysis steps)
    schedule_stage "reporting" "true" '[
      {
        "name": "generate_report",
        "dependsOn": ["analyze_sentiment", "calculate_trends"],
        "instances": 1,
        "maxRetries": 1,
        "env": { "FORMAT": "pdf" }
      }
    ]'
    ;;
esac

# Handle failures
if [ -n "$MAXQ_FAILED_STAGE" ]; then
  echo "Stage failed: $MAXQ_FAILED_STAGE"
  exit 1
fi
```

---

## 10. Error Handling and Retries

### 10.1 Step Failures

When a step fails (non-zero exit code):

1. **Check retry count**: If `retryCount < maxRetries`:
   - Increment `retryCount`
   - Set status to `pending`
   - Re-execute step

2. **Max retries exceeded**:
   - Set status to `failed`
   - Store error details in `error` field
   - Mark stage as `failed`
   - Call flow.sh with `MAXQ_FAILED_STAGE` set

### 10.2 Stage Failures

When any step in a stage fails (after all retries):

1. Set stage status to `failed`
2. Cancel all pending steps in the stage
3. Call flow.sh with:
   - `MAXQ_COMPLETED_STAGE`: Last successfully completed stage (may be empty)
   - `MAXQ_FAILED_STAGE`: Name of the failed stage

**Flow can decide to:**

- Exit with non-zero (fail the run)
- Schedule a recovery stage
- Schedule an alert stage

### 10.3 Flow Failures

When flow.sh exits with non-zero code:

1. MaxQ marks run status as `failed`
2. Cancels all pending steps
3. Stores flow error in run's `error` field

### 10.4 Timeout Handling

Implementations SHOULD support step timeouts via configuration:

```bash
# In step env (optional)
MAXQ_STEP_TIMEOUT=300  # Seconds
```

If a step exceeds timeout:

- Treat as failure
- Apply retry logic

### 10.5 Dependency Failures

If a step depends on a failed step:

1. Mark dependent step as `failed` (no execution)
2. Set error: `{ "reason": "dependency_failed", "failed_step": "fetch_data" }`
3. Propagate failure through dependency chain

---

## 11. Comparison to Other Systems

### 11.1 Metaflow

**Similarities:**

- Flow → Run → Step → Artifact model
- DAG-based execution
- Parallel execution support
- Artifact storage for data passing

**Differences:**

| Feature            | MaxQ                            | Metaflow                               |
| ------------------ | ------------------------------- | -------------------------------------- |
| Language           | Shell scripts                   | Python decorators                      |
| Orchestration      | Callback pattern                | Linear code execution                  |
| Step execution     | Separate processes via HTTP     | Python functions                       |
| Flow definition    | Filesystem-based                | Code-based with decorators             |
| Dependencies       | PostgreSQL only                 | Requires cloud services or local setup |
| Parallel execution | `instances` parameter           | `foreach` construct                    |
| Stage concept      | First-class (with `final` flag) | Not present                            |

**Example comparison:**

```python
# Metaflow
@step
def process(self):
    results = []
    for i in range(4):
        results.append(analyze(i))
    self.next(self.report)
```

```bash
# MaxQ
# In flow.sh stage scheduling:
{
  "name": "analyze",
  "instances": 4,
  "dependsOn": []
}
```

### 11.2 Prefect

**Similarities:**

- Task dependencies
- API-driven execution
- Retry logic

**Differences:**

| Feature          | MaxQ                       | Prefect                 |
| ---------------- | -------------------------- | ----------------------- |
| Language         | Shell scripts              | Python                  |
| Architecture     | Simple server + PostgreSQL | Agent-based + Cloud     |
| Flow definition  | Filesystem discovery       | Python decorators       |
| State management | PostgreSQL                 | Prefect Cloud or server |
| Complexity       | Minimal                    | Moderate to high        |

### 11.3 Argo Workflows

**Similarities:**

- DAG execution
- Container/process-based steps
- HTTP API

**Differences:**

| Feature       | MaxQ                        | Argo Workflows           |
| ------------- | --------------------------- | ------------------------ |
| Platform      | Any (just needs PostgreSQL) | Kubernetes only          |
| Definition    | Shell scripts               | YAML manifests           |
| Execution     | Native processes            | Kubernetes pods          |
| Stage concept | Built-in                    | Must be modeled manually |

### 11.4 Apache Airflow

**Similarities:**

- DAG-based workflows
- Task dependencies
- Retry logic

**Differences:**

| Feature         | MaxQ                | Airflow                             |
| --------------- | ------------------- | ----------------------------------- |
| Scheduling      | On-demand (via API) | Cron-based                          |
| Definition      | Shell scripts       | Python DAGs                         |
| Complexity      | Minimal             | High                                |
| Infrastructure  | PostgreSQL only     | Redis, Celery, Scheduler, Webserver |
| Stage callbacks | Built-in            | Not present                         |

### 11.5 Temporal

**Similarities:**

- Durable execution
- Retry handling

**Differences:**

| Feature      | MaxQ                 | Temporal                 |
| ------------ | -------------------- | ------------------------ |
| Model        | DAG (declarative)    | Imperative workflows     |
| Definition   | Shell scripts + HTTP | Go/Java/Python code      |
| Architecture | Simple server        | Workers + event sourcing |
| Complexity   | Minimal              | High                     |

---

## 12. Implementation Guidelines

### 12.1 Minimal Implementation Requirements

A conforming MaxQ implementation MUST:

1. **Discover flows** from `MAXQ_FLOWS_ROOT` directory
2. **Validate** flow.sh and step.sh files exist and are executable
3. **Spawn processes** for flows and steps with specified environment variables
4. **Implement HTTP API** as specified in section 6
5. **Use PostgreSQL** for state storage with schema from section 8
6. **Handle DAG dependencies** and execute steps in correct order
7. **Support parallel execution** via `instances` parameter
8. **Implement retry logic** for failed steps
9. **Implement stage callbacks** to flow.sh with completed/failed stage names
10. **Respect `final` flag** and not call flow.sh after final stage completes

### 12.2 Optional Features

Implementations MAY support:

- Filesystem watching (`MAXQ_WATCH_FLOWS`)
- Step timeouts
- Log table for execution logs
- Authentication mechanisms
- Rate limiting
- Webhooks for run completion
- Web UI for visualization
- Metrics and monitoring

### 12.3 Testing Requirements

Implementations SHOULD provide:

1. Unit tests for core logic
2. Integration tests for HTTP API
3. End-to-end tests with example workflows
4. Database migration tests
5. Filesystem discovery tests

---

## 13. Versioning and Compatibility

### 13.1 Specification Versioning

This specification uses semantic versioning:

- **Major version**: Breaking changes to API or protocol
- **Minor version**: New features (backward compatible)
- **Patch version**: Clarifications and bug fixes

Current version: **1.0.0**

### 13.2 Flow Compatibility

Flows should declare compatibility via a comment in flow.sh:

```bash
#!/bin/bash
# MAXQ_SPEC_VERSION: 1.0
```

MaxQ implementations MAY validate and reject incompatible flows.

### 13.3 API Versioning

The API is versioned via URL: `/api/v1/...`

Future versions would use: `/api/v2/...`

---

## 14. Security Considerations

### 14.1 Code Execution

MaxQ executes arbitrary shell scripts from `FLOWS_ROOT`. Implementations MUST:

- Run with least privilege
- Validate `FLOWS_ROOT` is a trusted directory
- Consider sandboxing (containers, jails, etc.)
- Log all executions

### 14.2 API Security

Implementations SHOULD:

- Require authentication for all endpoints
- Validate all inputs
- Use HTTPS in production
- Implement rate limiting
- Sanitize logs (avoid leaking secrets)

### 14.3 Database Security

- Use encrypted connections to PostgreSQL
- Apply principle of least privilege for database user
- Regular backups

### 14.4 Secrets Management

- Never log environment variables that may contain secrets
- Consider integration with secret managers (Vault, AWS Secrets Manager)
- Document best practices for secret handling in flows

---

## 15. Future Considerations

Features that may be added in future versions:

1. **Conditional Steps**: Execute steps based on conditions
2. **Step Templates**: Reusable step definitions
3. **Artifact Versioning**: Track artifact changes over time
4. **Run Scheduling**: Cron-like scheduling
5. **Webhooks**: Notify external systems on events
6. **Step Cancellation**: Cancel running steps
7. **Pause/Resume**: Pause and resume runs
8. **Sub-flows**: Nested workflows
9. **Dynamic DAGs**: Generate DAG at runtime
10. **Resource Limits**: CPU/memory constraints for steps

---

## Appendix A: Glossary

- **Flow**: A workflow definition (shell script)
- **Run**: A single execution instance of a flow
- **Stage**: A named batch of steps scheduled together
- **Step**: An individual unit of work (shell script)
- **Sequence**: Instance number for parallel steps (0, 1, 2, ...)
- **Artifact**: Data produced by a step
- **DAG**: Directed Acyclic Graph (dependency graph)
- **Final Stage**: The last stage in a workflow (no callback after completion)

---

## Appendix B: Complete Example

See `examples/market_analysis` directory for a complete working example including:

- Flow definition (flow.sh)
- Multiple step implementations
- Artifact storage and retrieval
- Error handling
- README with instructions

---

## Appendix C: API Client Libraries

Official client libraries:

- **Shell/Bash**: `examples/lib/maxq.sh` - Helper functions for flows and steps
- **Python**: (Future) `pip install maxq-client`
- **Node.js**: (Future) `npm install maxq-client`
- **Go**: (Future) `go get github.com/maxq/client-go`

---

## Appendix D: References

- [Metaflow Documentation](https://docs.metaflow.org)
- [Dagster Documentation](https://docs.dagster.io)
- [Argo Workflows](https://argoproj.github.io/workflows/)
- [Apache Airflow](https://airflow.apache.org)
- [Prefect](https://docs.prefect.io)

---

## Document History

| Version | Date       | Changes               |
| ------- | ---------- | --------------------- |
| 1.0.0   | 2025-10-11 | Initial specification |

---

**End of Specification**
