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

- DAG-based workflow execution with step dependencies
- Parallel step execution (flow generates multiple step IDs)
- Field-based data passing between steps
- Stage-based orchestration with callback pattern
- Retry logic for failed steps
- Filesystem-based flow discovery
- Simple HTTP/JSON protocol
- Flow-controlled step identification

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
- Has a unique ID supplied by the flow (e.g., "fetch-news", "scraper-1")
- Has dependencies on other steps via step IDs (DAG)
- Can retry on failure (configurable max retries)
- Posts fields containing results when execution completes

**Status Values:**

- `pending`: Created but not yet executing
- `running`: Currently executing
- `completed`: Finished successfully
- `failed`: Execution failed after all retries
- `cancelled`: Manually cancelled

**Step ID vs Step Name:**

- **ID**: Unique identifier supplied by flow (e.g., "scraper-1", "scraper-2") - must be unique within run
- **Name**: Script directory name (e.g., "scraper", "scraper") - multiple steps can share the same name

**Example for parallel processing:**

```json
// Flow generates multiple steps with same name but different IDs
{
  "steps": [
    { "id": "scraper-0", "name": "scraper" },
    { "id": "scraper-1", "name": "scraper" },
    { "id": "scraper-2", "name": "scraper" }
  ]
}
// All three execute: FLOWS_ROOT/my_flow/steps/scraper/step.sh
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
2. **MaxQ creates run**: Stores in database with status `pending`
3. **MaxQ spawns flow.sh**: With environment variables (including empty `MAXQ_COMPLETED_STAGE`)
4. **Flow schedules stage**: `POST /api/v1/runs/{runId}/steps` with step definitions
   - Each step has unique `id` (flow-supplied) and `name` (script directory)
   - Example: `{"id": "scraper-1", "name": "scraper"}`, `{"id": "scraper-2", "name": "scraper"}`
5. **MaxQ validates and creates steps**:
   - Validates step IDs (alphanumeric + hyphens + underscores)
   - Checks ID uniqueness within run
   - Creates step records
6. **MaxQ spawns step.sh**: For each step (respecting `dependsOn` DAG)
   - Passes `MAXQ_STEP_ID` (unique ID) and `MAXQ_STEP_NAME` (script name)
   - Resolves script: `{flowsRoot}/{flowName}/steps/{name}/step.sh`
7. **Steps execute and post fields**: `POST /api/v1/runs/{runId}/steps/{stepId}/fields` when complete
   - Fields contain all step results as arbitrary JSON
8. **Stage completes**: All steps in stage have posted fields (or failed)
9. **If stage not final**: MaxQ calls flow.sh again with `MAXQ_COMPLETED_STAGE` set
10. **Repeat 4-9**: Until flow marks a stage as `final: true`
11. **Final stage completes**: Run automatically marked as `completed`

### 3.3 Data Storage

- **PostgreSQL**: Single source of truth for all state
- **No Queue System**: MaxQ directly spawns processes
- **No External Storage**: All step data stored as fields in database (JSONB)

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
   POST /runs/{runId}/steps
   {
     "stage": "data-fetch",
     "final": false,
     "steps": [
       {"id": "fetch-news", "name": "fetch_news", "dependsOn": [], ...},
       {"id": "fetch-prices", "name": "fetch_prices", "dependsOn": [], ...}
     ]
   }

4. MaxQ validates step IDs and creates step records
   ↓
   MaxQ spawns step.sh processes (respecting dependsOn DAG)
   → Spawns: steps/fetch_news/step.sh with MAXQ_STEP_ID=fetch-news
   → Spawns: steps/fetch_prices/step.sh with MAXQ_STEP_ID=fetch-prices

5. Steps execute and post fields when complete
   POST /runs/{runId}/steps/fetch-news/fields
   {"fields": {"articles": [...], "count": 42}}

   POST /runs/{runId}/steps/fetch-prices/fields
   {"fields": {"prices": [...], "count": 100}}
   ↓
   All steps in "data-fetch" have posted fields

6. MaxQ calls flow.sh (MAXQ_COMPLETED_STAGE="data-fetch")
   ↓
   Flow schedules stage "analysis" (final: false) with 4 parallel analyzers
   {
     "stage": "analysis",
     "final": false,
     "steps": [
       {"id": "analyzer-0", "name": "analyzer", "dependsOn": ["fetch-news"], ...},
       {"id": "analyzer-1", "name": "analyzer", "dependsOn": ["fetch-news"], ...},
       {"id": "analyzer-2", "name": "analyzer", "dependsOn": ["fetch-news"], ...},
       {"id": "analyzer-3", "name": "analyzer", "dependsOn": ["fetch-news"], ...}
     ]
   }

7. MaxQ spawns analyzer steps (all execute steps/analyzer/step.sh)
   ↓
   Steps query fields: GET /runs/{runId}/fields?stepId=fetch-news
   Steps execute and post their own fields

8. All analyzer steps complete
   ↓
   MaxQ calls flow.sh (MAXQ_COMPLETED_STAGE="analysis")
   ↓
   Flow schedules stage "reporting" (final: true)

9. MaxQ spawns reporting step
   ↓
   Step queries all analyzer fields: GET /runs/{runId}/fields?stepId=analyzer-0,analyzer-1,...
   Step generates report and posts fields
   ↓
   Final stage completes

10. MaxQ marks run as completed automatically (no callback for final stage)
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

- MaxQ builds a DAG from `dependsOn` relationships (using step IDs)
- Steps without dependencies start immediately
- Dependent steps wait for all dependencies to complete

**Parallel Execution:**

- Steps with no dependencies execute in parallel
- Flow generates multiple step IDs to enable parallel execution
- All steps with same `name` execute the same script

**Example:**

```json
{
  "steps": [
    { "id": "fetch-news", "name": "fetch_news", "dependsOn": [] },
    { "id": "fetch-prices", "name": "fetch_prices", "dependsOn": [] },
    {
      "id": "analyze-0",
      "name": "analyze",
      "dependsOn": ["fetch-news", "fetch-prices"]
    },
    {
      "id": "analyze-1",
      "name": "analyze",
      "dependsOn": ["fetch-news", "fetch-prices"]
    },
    {
      "id": "analyze-2",
      "name": "analyze",
      "dependsOn": ["fetch-news", "fetch-prices"]
    },
    {
      "id": "analyze-3",
      "name": "analyze",
      "dependsOn": ["fetch-news", "fetch-prices"]
    }
  ]
}
```

Execution order:

1. `fetch-news` and `fetch-prices` start in parallel
2. When both complete, all 4 analyze steps start in parallel
3. All execute the same script: `steps/analyze/step.sh`
4. Each receives unique `MAXQ_STEP_ID` (analyze-0, analyze-1, analyze-2, analyze-3)

### 5.4 Process Spawning

MaxQ spawns shell processes with:

- Working directory: `{FLOWS_ROOT}/{flowName}` for flows
- Working directory: `{FLOWS_ROOT}/{flowName}/steps/{stepName}` for steps
- Environment variables (see section 7)
- Standard input: closed
- Standard output: captured and logged
- Standard error: captured and logged

### 5.5 Completion Mechanism

**Primary Completion Signal: HTTP POST Calls**

Steps signal completion by making HTTP POST calls to MaxQ:

- **Steps**: POST to `/runs/{runId}/steps/{stepId}/fields` when execution completes

Flows do not need to signal completion. When all steps in a stage marked with `final: true` complete, the run is automatically marked as completed by MaxQ.

**The HTTP POST call itself IS the completion notification.** This is the primary mechanism for signaling that execution has finished.

**Exit Codes (Secondary)**

Exit codes are also captured for debugging purposes:

**Flow exit codes:**

- `0`: Success
- `Non-zero`: Failure (MaxQ marks run as failed if no result POST was made)

**Step exit codes:**

- `0`: Success
- `Non-zero`: Failure (step failed, may retry if no result POST was made)

**stdout/stderr (Debugging Only)**

Standard output and standard error streams are captured and stored for debugging purposes but are not used for primary data passing or completion signaling. All data passing should use the HTTP API (artifacts, result POSTs).

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
      "id": "fetch-news",
      "name": "fetch_news",
      "dependsOn": [],
      "maxRetries": 3,
      "env": {
        "SOURCE": "reuters",
        "API_KEY": "secret123"
      }
    },
    {
      "id": "fetch-prices",
      "name": "fetch_prices",
      "dependsOn": [],
      "maxRetries": 3,
      "env": {
        "SYMBOL": "AAPL"
      }
    }
  ]
}
```

**Parallel Execution Example:**

To run 4 parallel analyzers, the flow generates 4 steps with unique IDs:

```json
{
  "stage": "analysis",
  "final": false,
  "steps": [
    {
      "id": "analyzer-0",
      "name": "analyzer",
      "dependsOn": ["fetch-news"],
      "maxRetries": 2,
      "env": { "SHARD": "0" }
    },
    {
      "id": "analyzer-1",
      "name": "analyzer",
      "dependsOn": ["fetch-news"],
      "maxRetries": 2,
      "env": { "SHARD": "1" }
    },
    {
      "id": "analyzer-2",
      "name": "analyzer",
      "dependsOn": ["fetch-news"],
      "maxRetries": 2,
      "env": { "SHARD": "2" }
    },
    {
      "id": "analyzer-3",
      "name": "analyzer",
      "dependsOn": ["fetch-news"],
      "maxRetries": 2,
      "env": { "SHARD": "3" }
    }
  ]
}
```

All 4 steps execute the same script `steps/analyzer/step.sh`, but each receives a unique `MAXQ_STEP_ID`.

**Field Descriptions:**

- `stage` (required, string): Name of this stage
- `final` (required, boolean): If true, no callback after this stage completes
- `steps` (required, array): Array of step definitions
  - `id` (required, string): Unique step identifier supplied by flow
    - **Validation**: Must match regex `^[a-zA-Z0-9_-]+$` (alphanumeric, hyphens, underscores only)
    - **Uniqueness**: Must be unique within the run (across all stages)
    - **Examples**: "fetch-news", "analyzer-0", "scraper-batch-1"
    - MaxQ MUST reject with 400 Bad Request if validation fails
  - `name` (required, string): Step script directory name (must exist in filesystem)
    - Multiple steps can share the same name (parallel execution)
    - Resolves to: `{flowsRoot}/{flowName}/steps/{name}/step.sh`
  - `dependsOn` (optional, array): Array of step IDs this step depends on
    - References step IDs, not step names
    - Dependencies are within the same stage only
    - Cross-stage dependencies are implicit (all previous stages complete before current stage)
  - `maxRetries` (required, number): Max retry attempts on failure (0+)
  - `env` (optional, object): Environment variables passed to step.sh

**Response:** `201 Created`

```json
{
  "stage": "data-fetch",
  "scheduled": 2,
  "steps": [
    {
      "id": "fetch-news",
      "name": "fetch_news",
      "status": "pending"
    },
    {
      "id": "fetch-prices",
      "name": "fetch_prices",
      "status": "pending"
    }
  ]
}
```

**Error Response:** `400 Bad Request`

Invalid step ID format:

```json
{
  "error": "Invalid step ID",
  "code": "INVALID_STEP_ID",
  "details": {
    "stepId": "fetch news!",
    "reason": "Step ID must match pattern: ^[a-zA-Z0-9_-]+$"
  }
}
```

Duplicate step ID:

```json
{
  "error": "Duplicate step ID",
  "code": "DUPLICATE_STEP_ID",
  "details": {
    "stepId": "fetch-news",
    "reason": "Step ID already exists in this run"
  }
}
```

Step script not found:

```json
{
  "error": "Step not found",
  "code": "STEP_NOT_FOUND",
  "details": {
    "name": "fetch_news",
    "path": "/flows/my_flow/steps/fetch_news/step.sh",
    "reason": "Step script does not exist or is not executable"
  }
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

#### 6.4.9 Post Step Fields

```
POST /runs/{runId}/steps/{stepId}/fields
```

Called by step.sh to post fields and signal completion. **The act of making this HTTP call signals that step execution has finished.** This is the primary completion mechanism for steps.

The `stepId` in the URL is the identifier supplied by the flow when scheduling the stage (see 6.4.5).

**Request Body:**

```json
{
  "fields": {
    "status": "completed",
    "articles_fetched": 42,
    "raw_data": {
      "articles": [...]
    },
    "processing_time_ms": 1234,
    "metadata": {
      "source": "reuters-api"
    }
  }
}
```

**Field Descriptions:**

- `fields` (required, object): Arbitrary key-value pairs storing step results. Steps can post any data structure here. By convention, include a `status` field with value `completed` or `failed`.

**Response:** `200 OK`

```json
{
  "id": "fetch-news",
  "runId": "run-uuid-123",
  "fields": {
    "status": "completed",
    "articles_fetched": 42,
    "raw_data": {...},
    "processing_time_ms": 1234,
    "metadata": {...}
  },
  "completedAt": 1704067210000
}
```

**Notes:**

- Steps SHOULD call this endpoint when execution completes (success or failure)
- If a step process exits without calling this endpoint, MaxQ will mark it as failed based on exit code
- All fields are stored in the database and can be queried by downstream steps via "Query Step Results" (6.4.10)
- No predefined schema - steps can post any fields they need
- By convention, use a `status` field with value `completed` or `failed` to indicate success/failure
- The `stepId` in the URL must match the ID supplied by the flow when scheduling the stage

---

#### 6.4.10 Query Step Fields

```
GET /runs/{runId}/fields
```

Query fields posted by steps. This is how steps retrieve data from upstream dependencies.

**Query Parameters:**

- `stepId` (optional): Filter by specific step ID (exact match)
- `fieldName` (optional): Filter results to only include specific field name

**Response:**

```json
{
  "fields": [
    {
      "stepId": "fetch-news",
      "stepName": "fetch_news",
      "stageId": "stage-uuid-1",
      "stageName": "data-fetch",
      "status": "completed",
      "fields": {
        "articles_fetched": 42,
        "raw_data": {...},
        "processing_time_ms": 1234
      },
      "completedAt": 1704067210000
    },
    {
      "stepId": "analyzer-0",
      "stepName": "analyzer",
      "stageId": "stage-uuid-2",
      "stageName": "analysis",
      "status": "completed",
      "fields": {
        "sentiment_score": 0.75,
        "analyzed_articles": 10
      },
      "completedAt": 1704067220000
    }
  ]
}
```

**Example Queries:**

```bash
# Get fields from a specific step
GET /runs/{runId}/fields?stepId=fetch-news

# Get fields containing specific field name (filters response to include only that field)
GET /runs/{runId}/fields?fieldName=sentiment_score
# Returns: [{"stepId": "analyzer-0", "fields": {"sentiment_score": 0.75}}, ...]

# Get all fields (no filters)
GET /runs/{runId}/fields
```

**Usage in Steps:**

```bash
#!/bin/bash
# Get upstream step data
NEWS=$(curl "$MAXQ_API/runs/$MAXQ_RUN_ID/fields?stepId=fetch-news" | \
  jq -r '.fields[0].fields.raw_data')

# Process the data...
# Post results
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps/$MAXQ_STEP_ID/fields" \
  -H "Content-Type: application/json" \
  -d "{\"fields\": {\"status\": \"completed\", \"result\": ...}}"
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
MAXQ_RUN_ID=run-uuid-123              # Run identifier (UUID)
MAXQ_STEP_ID=fetch-news               # Unique step identifier (supplied by flow)
MAXQ_STEP_NAME=fetch_news             # Step script directory name
MAXQ_FLOW_NAME=market_analysis        # Name of the flow
MAXQ_STAGE=data-fetch                 # Stage this step belongs to
MAXQ_API=http://localhost:3000/api/v1 # MaxQ API base URL

# Custom (from step definition)
SOURCE=reuters                        # User-defined env vars
API_KEY=secret123                     # from "env" field in stage scheduling
```

**Example for parallel execution:**

When a flow schedules 3 parallel steps with the same script:

```json
{
  "steps": [
    { "id": "scraper-0", "name": "scraper", "env": { "SHARD": "0" } },
    { "id": "scraper-1", "name": "scraper", "env": { "SHARD": "1" } },
    { "id": "scraper-2", "name": "scraper", "env": { "SHARD": "2" } }
  ]
}
```

Each receives:

```bash
# Instance 0
MAXQ_STEP_ID=scraper-0
MAXQ_STEP_NAME=scraper
SHARD=0

# Instance 1
MAXQ_STEP_ID=scraper-1
MAXQ_STEP_NAME=scraper
SHARD=1

# Instance 2
MAXQ_STEP_ID=scraper-2
MAXQ_STEP_NAME=scraper
SHARD=2
```

All three execute the same script: `steps/scraper/step.sh`

**Key Points:**

- `MAXQ_STEP_ID`: Unique identifier supplied by flow (e.g., "scraper-0", "scraper-1")
- `MAXQ_STEP_NAME`: Script directory name (e.g., "scraper")
- Multiple steps can share the same `MAXQ_STEP_NAME` but have unique `MAXQ_STEP_ID`
- Steps use `MAXQ_STEP_ID` when posting fields: `POST /runs/{runId}/steps/{stepId}/fields`

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
  id                TEXT PRIMARY KEY,        -- Unique step ID supplied by flow (e.g., "fetch-news", "scraper-0")
  run_id            TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  stage_id          TEXT NOT NULL REFERENCES stage(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,           -- Step script directory name (e.g., "fetch_news", "scraper")
  status            TEXT NOT NULL,           -- pending, running, completed, failed, cancelled
  depends_on        JSONB NOT NULL,          -- Array of step IDs: ["fetch-news", "fetch-prices"]
  retry_count       INTEGER NOT NULL DEFAULT 0,
  max_retries       INTEGER NOT NULL,
  env               JSONB,                   -- Environment variables
  fields            JSONB,                   -- Step fields posted via POST /runs/{runId}/steps/{stepId}/fields
  error             JSONB,                   -- Error details
  created_at        BIGINT NOT NULL,
  started_at        BIGINT,
  completed_at      BIGINT,
  duration_ms       BIGINT,
  stdout            TEXT,                    -- Captured stdout from step process
  stderr            TEXT                     -- Captured stderr from step process
);

CREATE INDEX idx_step_run_id ON step(run_id);
CREATE INDEX idx_step_stage_id ON step(stage_id);
CREATE INDEX idx_step_status ON step(status);
CREATE INDEX idx_step_name ON step(run_id, name);
CREATE UNIQUE INDEX idx_step_id ON step(run_id, id);  -- Enforce ID uniqueness within run
```

**Key Points:**

- `id`: Flow-supplied unique identifier (e.g., "fetch-news", "scraper-0", "scraper-1")
- `name`: Script directory name - multiple steps can share the same name
- `depends_on`: Array of step IDs, not names
- `fields`: Arbitrary JSON data posted by steps
- No `sequence` column - flows generate explicit IDs
- Unique constraint on (run_id, id) ensures no duplicate IDs

### 8.4 `log` Table (Optional)

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
        "id": "greet-step",
        "name": "greet",
        "dependsOn": [],
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
        "id": "goodbye-step",
        "name": "goodbye",
        "dependsOn": [],
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

# Post fields to signal completion
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps/$MAXQ_STEP_ID/fields" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"status\": \"completed\",
      \"greeting_message\": \"Hello, $NAME!\",
      \"timestamp\": $(date +%s)
    }
  }"
```

**steps/goodbye/step.sh:**

```bash
#!/bin/bash
set -e

# Fetch greeting from previous step
GREETING=$(curl "$MAXQ_API/runs/$MAXQ_RUN_ID/steps?id=greet-step" | \
  jq -r '.steps[0].fields.greeting_message')

echo "Previous greeting was: $GREETING"
echo "Goodbye!"

# Post fields to signal completion
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps/$MAXQ_STEP_ID/fields" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"status\": \"completed\",
      \"farewell_message\": \"Goodbye!\",
      \"previous_greeting\": \"$GREETING\"
    }
  }"
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
        "id": "fetch-urls",
        "name": "fetch_urls",
        "dependsOn": [],
        "maxRetries": 3,
        "env": { "SOURCE": "https://example.com/sitemap.xml" }
      }]
    }'

elif [ "$MAXQ_COMPLETED_STAGE" = "fetch" ]; then
  # Stage 2: Scrape 10 pages in parallel
  # Flow generates 10 steps with unique IDs
  curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
    -H "Content-Type: application/json" \
    -d '{
      "stage": "scrape",
      "final": false,
      "steps": [
        {"id": "scrape-0", "name": "scrape_page", "dependsOn": ["fetch-urls"], "maxRetries": 2, "env": {"INDEX": "0"}},
        {"id": "scrape-1", "name": "scrape_page", "dependsOn": ["fetch-urls"], "maxRetries": 2, "env": {"INDEX": "1"}},
        {"id": "scrape-2", "name": "scrape_page", "dependsOn": ["fetch-urls"], "maxRetries": 2, "env": {"INDEX": "2"}},
        {"id": "scrape-3", "name": "scrape_page", "dependsOn": ["fetch-urls"], "maxRetries": 2, "env": {"INDEX": "3"}},
        {"id": "scrape-4", "name": "scrape_page", "dependsOn": ["fetch-urls"], "maxRetries": 2, "env": {"INDEX": "4"}},
        {"id": "scrape-5", "name": "scrape_page", "dependsOn": ["fetch-urls"], "maxRetries": 2, "env": {"INDEX": "5"}},
        {"id": "scrape-6", "name": "scrape_page", "dependsOn": ["fetch-urls"], "maxRetries": 2, "env": {"INDEX": "6"}},
        {"id": "scrape-7", "name": "scrape_page", "dependsOn": ["fetch-urls"], "maxRetries": 2, "env": {"INDEX": "7"}},
        {"id": "scrape-8", "name": "scrape_page", "dependsOn": ["fetch-urls"], "maxRetries": 2, "env": {"INDEX": "8"}},
        {"id": "scrape-9", "name": "scrape_page", "dependsOn": ["fetch-urls"], "maxRetries": 2, "env": {"INDEX": "9"}}
      ]
    }'

elif [ "$MAXQ_COMPLETED_STAGE" = "scrape" ]; then
  # Stage 3: Aggregate results
  curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
    -H "Content-Type: application/json" \
    -d '{
      "stage": "aggregate",
      "final": true,
      "steps": [{
        "id": "aggregate-results",
        "name": "aggregate",
        "dependsOn": [],
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
URLS_JSON=$(echo "$URLS" | jq -R -s -c 'split("\n") | map(select(length > 0))')

# Post fields with URL list
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps/$MAXQ_STEP_ID/fields" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"status\": \"completed\",
      \"urls\": $URLS_JSON,
      \"count\": $(echo "$URLS_JSON" | jq 'length')
    }
  }"
```

**steps/scrape_page/step.sh:**

```bash
#!/bin/bash
set -e

# Get URLs from previous step
URLS=$(curl "$MAXQ_API/runs/$MAXQ_RUN_ID/fields?stepId=fetch-urls" | \
  jq -r '.fields[0].fields.urls')

# Each instance processes one URL using INDEX env variable
URL=$(echo "$URLS" | jq -r ".[$INDEX]")

echo "Scraping: $URL (INDEX=$INDEX, STEP_ID=$MAXQ_STEP_ID)"
CONTENT=$(curl -s "$URL" | html2text)
CONTENT_JSON=$(echo "$CONTENT" | jq -R -s)

# Post fields with scraped content
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps/$MAXQ_STEP_ID/fields" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"status\": \"completed\",
      \"url\": \"$URL\",
      \"content\": $CONTENT_JSON,
      \"length\": ${#CONTENT}
    }
  }"
```

**steps/aggregate/step.sh:**

```bash
#!/bin/bash
set -e

# Fetch all scraped page fields
# Query all steps named scrape_page or query all fields
PAGES=$(curl "$MAXQ_API/runs/$MAXQ_RUN_ID/fields")

# Filter to scrape-* steps and aggregate
SCRAPE_FIELDS=$(echo "$PAGES" | jq '[.fields[] | select(.stepId | startswith("scrape-"))]')
TOTAL=$(echo "$SCRAPE_FIELDS" | jq 'length')
echo "Scraped $TOTAL pages"

# Calculate total content length
TOTAL_LENGTH=$(echo "$SCRAPE_FIELDS" | jq '[.[].fields.length] | add')

# Post fields with summary
curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps/$MAXQ_STEP_ID/fields" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"status\": \"completed\",
      \"total_pages\": $TOTAL,
      \"total_content_length\": $TOTAL_LENGTH,
      \"timestamp\": $(date +%s)
    }
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
        "id": "fetch-news",
        "name": "fetch_news",
        "dependsOn": [],
        "maxRetries": 3,
        "env": { "SOURCE": "reuters" }
      },
      {
        "id": "fetch-prices",
        "name": "fetch_prices",
        "dependsOn": [],
        "maxRetries": 3,
        "env": { "SYMBOL": "AAPL" }
      }
    ]'
    ;;

  "data-fetch")
    # Stage 2: Analyze data (4 parallel sentiment analyzers)
    # Flow explicitly generates 4 analyzer steps with unique IDs
    schedule_stage "analysis" "false" '[
      {
        "id": "analyzer-0",
        "name": "analyze_sentiment",
        "dependsOn": ["fetch-news"],
        "maxRetries": 2,
        "env": { "MODEL": "sentiment-v2", "SHARD": "0" }
      },
      {
        "id": "analyzer-1",
        "name": "analyze_sentiment",
        "dependsOn": ["fetch-news"],
        "maxRetries": 2,
        "env": { "MODEL": "sentiment-v2", "SHARD": "1" }
      },
      {
        "id": "analyzer-2",
        "name": "analyze_sentiment",
        "dependsOn": ["fetch-news"],
        "maxRetries": 2,
        "env": { "MODEL": "sentiment-v2", "SHARD": "2" }
      },
      {
        "id": "analyzer-3",
        "name": "analyze_sentiment",
        "dependsOn": ["fetch-news"],
        "maxRetries": 2,
        "env": { "MODEL": "sentiment-v2", "SHARD": "3" }
      },
      {
        "id": "calculate-trends",
        "name": "calculate_trends",
        "dependsOn": ["fetch-prices"],
        "maxRetries": 2,
        "env": {}
      }
    ]'
    ;;

  "analysis")
    # Stage 3: Generate report
    schedule_stage "reporting" "true" '[
      {
        "id": "generate-report",
        "name": "generate_report",
        "dependsOn": [],
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

- Flow → Run → Step model
- DAG-based execution
- Parallel execution support
- Data passing between steps

**Differences:**

| Feature            | MaxQ                            | Metaflow                               |
| ------------------ | ------------------------------- | -------------------------------------- |
| Language           | Shell scripts                   | Python decorators                      |
| Orchestration      | Callback pattern                | Linear code execution                  |
| Step execution     | Separate processes via HTTP     | Python functions                       |
| Flow definition    | Filesystem-based                | Code-based with decorators             |
| Dependencies       | PostgreSQL only                 | Requires cloud services or local setup |
| Parallel execution | Flow generates multiple IDs     | `foreach` construct                    |
| Data passing       | Fields (JSON in database)       | Artifacts (object storage)             |
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

```json
// MaxQ - In flow.sh stage scheduling:
{
  "steps": [
    { "id": "analyze-0", "name": "analyze" },
    { "id": "analyze-1", "name": "analyze" },
    { "id": "analyze-2", "name": "analyze" },
    { "id": "analyze-3", "name": "analyze" }
  ]
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
7. **Support parallel execution** (flows generate multiple step IDs with same name)
8. **Validate step IDs** (alphanumeric + hyphens + underscores, unique within run)
9. **Implement retry logic** for failed steps
10. **Implement stage callbacks** to flow.sh with completed/failed stage names
11. **Respect `final` flag** and not call flow.sh after final stage completes

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
- **Step ID**: Unique identifier for a step supplied by flow (e.g., "fetch-news", "analyzer-0")
- **Step Name**: Script directory name - multiple steps can share the same name
- **Fields**: Arbitrary JSON data posted by steps when execution completes
- **DAG**: Directed Acyclic Graph (dependency graph)
- **Final Stage**: The last stage in a workflow (no callback after completion)

---

## Appendix B: Complete Example

See `examples/market_analysis` directory for a complete working example including:

- Flow definition (flow.sh)
- Multiple step implementations
- Field-based data passing
- Parallel step execution
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
