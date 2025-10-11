# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the MaxQ codebase.

## Critical Guidelines

### NEVER ACT WITHOUT EXPLICIT USER APPROVAL

**YOU MUST ALWAYS ASK FOR PERMISSION BEFORE:**

- Making architectural decisions or changes
- Implementing new features or functionality
- Modifying APIs, interfaces, or data structures
- Changing expected behavior or test expectations
- Adding new dependencies or patterns

**ONLY make changes AFTER the user explicitly approves.** When you identify issues or potential improvements, explain them clearly and wait for the user's decision. Do NOT assume what the user wants or make "helpful" changes without permission.

### FINISH DISCUSSIONS BEFORE WRITING CODE

**IMPORTANT**: When the user asks a question or you're in the middle of a discussion, DO NOT jump to writing code. Always:

1. **Complete the discussion first** - Understand the problem fully
2. **Analyze and explain** - Work through the issue verbally
3. **Get confirmation** - Ensure the user agrees with the approach
4. **Only then write code** - After the user explicitly asks you to implement

### NEVER USE MULTIEDIT

**NEVER use the MultiEdit tool.** It has caused issues in multiple projects. Always use individual Edit operations instead, even if it means more edits. This ensures better control and prevents unintended changes.

## Session Startup & Task Management

### First Steps When Starting a Session

When you begin working on this project, you MUST:

1. **Read this entire CLAUDE.md file** to understand the project structure and conventions
2. **Check for ongoing tasks in `.todos/` directory** - Look for any in-progress task files
3. **Read the key documentation files** in this order:
   - `/README.md` - Project overview and quick start
   - `/CODING-STANDARDS.md` - Mandatory coding patterns and conventions
   - `/docs/specification.md` - Complete MaxQ specification with HTTP API and workflows
   - `/docs/examples/` - Working examples of flows and steps
   - Any other relevant docs based on the task at hand

Only after reading these documents should you proceed with any implementation or analysis tasks.

**IMPORTANT**: After every conversation compact/summary, you MUST re-read this CLAUDE.md file again as your first action.

### Task Management with .todos Directory

**For major multi-step tasks that span sessions:**

1. **Before starting**, create a detailed task file in `.todos/` directory:
   - Filename format: `YYYY-MM-DD-task-name.md` (e.g., `2025-01-13-workflow-implementation.md`)
   - Include ALL context, decisions, completed work, and remaining work
   - Write comprehensively so the task can be resumed in any future session

2. **Task file must include**:
   - Task overview and objectives
   - Current status (what's been completed)
   - Detailed list of remaining work
   - Important decisions made
   - Code locations affected
   - Testing requirements
   - Any gotchas or special considerations

3. **When resuming work**, always check `.todos/` first for in-progress tasks
4. **Update the task file** as you make progress
5. **Mark as complete** by renaming to `YYYY-MM-DD-task-name-COMPLETED.md`

The `.todos/` directory is gitignored for persistent task tracking across sessions.

## Project Overview & Principles

This guide helps AI assistants work effectively with the MaxQ codebase. For project overview, see [README.md](../README.md).

### Greenfield Development Context

**IMPORTANT**: MaxQ is a greenfield project with no legacy constraints:

- **No backward compatibility concerns** - No existing deployments or users to migrate
- **No legacy code patterns** - All code should follow current best practices without compromise
- **No migration paths needed** - Database schemas, APIs, and data structures can be designed optimally
- **Write code as if starting fresh** - Every implementation should be clean and modern
- **No change tracking in comments** - Avoid "changed from X to Y" since there is no "previous" state
- **No deprecation warnings** - Nothing is deprecated because nothing is legacy

This means: Focus on clean, optimal implementations without worrying about existing systems. Design for the ideal case, not for compatibility.

### Documentation & Code Principles

**Documentation Guidelines:**

- Write as if the spec was designed from the beginning, not evolved over time
- Avoid phrases like "now allows", "changed from", "previously was"
- Present features and constraints as inherent design decisions
- Be concise and technical - avoid promotional language, superlatives
- Use active voice and include code examples
- Keep README.md as single source of truth

**Code Principles:**

- **NO BACKWARDS COMPATIBILITY** - Do not write backwards compatibility code
- **NO CLASSES** - Export functions from modules only, use explicit dependency injection
- **NO DYNAMIC IMPORTS** - Always use static imports, never `await import()` or `import()`
- Use pure functions with Result types for error handling instead of exceptions
- Prefer `type` over `interface` (use `interface` only for extensible contracts)

## Core Architecture Principles

### 1. Filesystem-Based Flow Discovery

- **NEVER** use a flow registration API
- **ALWAYS** discover flows from filesystem: `{FLOWS_ROOT}/{flowName}/flow.sh`
- Steps located at: `{FLOWS_ROOT}/{flowName}/steps/{stepName}/step.sh`
- MaxQ spawns processes and communicates via HTTP JSON API

### 2. Stage-Based Orchestration

- Steps grouped into named stages (e.g., "data-fetch", "analysis", "reporting")
- Flow callbacks with `MAXQ_COMPLETED_STAGE` environment variable
- Final stage marked with `final: true` - no callback after completion
- DAG execution with parallel step instances via sequence numbers

### 3. Security: Never Use npx

**CRITICAL SECURITY REQUIREMENT**: NEVER use `npx` for any commands. This poses grave security risks by executing arbitrary code.

- **ALWAYS use exact dependency versions** in package.json
- **ALWAYS use local node_modules binaries** (e.g., `prettier`, `mocha`, `http-server`)
- **NEVER use `npx prettier`** - use `prettier` from local dependencies
- **NEVER use `npx mocha`** - use `mocha` from local dependencies

**Exception**: Only acceptable `npx` usage is for one-time project initialization when explicitly setting up new projects.

### 4. REST API Design

- RESTful endpoints (no GraphQL)
- JSON request/response bodies
- Standard HTTP status codes
- Bearer token authentication in Authorization header
- Consistent error response format

### 5. Database Conventions

- **PostgreSQL AND SQLite support** with **Tinqer** for type-safe queries
- **Knex.js** for migrations (supports both databases)
- Table names: **singular** and **snake_case** (e.g., `run`, `step`, `artifact`)
- TypeScript: **camelCase** for all variables/properties
- SQL: **snake_case** for all table/column names
- **DbRow Pattern**: All persistence functions use `XxxDbRow` types that mirror exact database schema
- **Mapper Functions**: `mapXxxFromDb()` and `mapXxxToDb()` handle conversions between snake_case DB and camelCase domain types
- **Repository Pattern**: Abstract database differences between PostgreSQL and SQLite

**Query Optimization Guidelines**:

- **Prefer simple separate queries over complex joins** when it only saves 1-3 database calls
- **Use joins only to prevent N+1 query problems** (e.g., fetching data for many items in a loop)
- **Prioritize code simplicity and readability** over minor performance optimizations

### 6. ESM Modules

- All imports MUST include `.js` extension: `import { foo } from "./bar.js"`
- TypeScript configured for `"module": "NodeNext"`
- Type: `"module"` in all package.json files
- **NO DYNAMIC IMPORTS**: Always use static imports. Never use `await import()` or `import()` in the code

## Essential Commands & Workflow

### Build & Development Commands

```bash
# Install dependencies (optional - build.sh does this automatically)
./scripts/install-deps.sh         # Install only if node_modules missing
./scripts/install-deps.sh --force # Force reinstall all dependencies

# Build entire project (from root)
./scripts/build.sh              # Standard build with formatting
./scripts/build.sh --install    # Force npm install in all packages
./scripts/build.sh --migrate    # Build + run DB migrations
./scripts/build.sh --no-format  # Skip prettier formatting (faster builds)

# Clean build artifacts
./scripts/clean.sh

# Start the server
./scripts/start.sh

# Lint entire project (from root)
./scripts/lint-all.sh           # Run ESLint on all packages
./scripts/lint-all.sh --fix     # Run ESLint with auto-fix

# Format code with Prettier (MUST run before committing)
./scripts/format-all.sh         # Format all files
./scripts/format-all.sh --check # Check formatting without changing files

# Docker commands
./scripts/docker-build.sh       # Build Docker image
./scripts/docker-test.sh        # Test Docker image
./scripts/docker-push.sh latest ghcr.io/codespin-ai  # Push to registry
```

### Database Commands

**IMPORTANT**: NEVER run database migrations unless explicitly instructed by the user

```bash
# Check migration status (safe to run)
npm run migrate:maxq:status

# Create new migration (safe to run)
npm run migrate:maxq:make migration_name

# Run migrations (ONLY when explicitly asked)
npm run migrate:maxq:latest
npm run migrate:maxq:rollback

# Create seed file (safe to run)
npm run seed:maxq:make seed_name

# Run seeds (ONLY when explicitly asked)
npm run seed:maxq:run
```

### Testing Commands

```bash
# Run all tests (integration + client)
npm test

# Search for specific tests across BOTH integration and client
npm run test:grep -- "pattern to match"

# Search only integration tests
npm run test:integration:grep -- "pattern to match"

# Search only client tests
npm run test:client:grep -- "pattern to match"

# Examples:
npm run test:grep -- "should create"          # Searches both integration and client
npm run test:grep -- "workflow"               # Searches both integration and client
npm run test:integration:grep -- "execution"  # Only integration tests
npm run test:client:grep -- "fetch flow"      # Only client tests
```

**IMPORTANT**: When running tests with mocha, always use `npm run test:grep -- "pattern"` from the root directory for specific tests. NEVER use `2>&1` redirection with mocha commands. Use `| tee` for output capture.

### Git Workflow

**CRITICAL GIT SAFETY RULES**:

1. **NEVER use `git push --force` or `git push -f`** - Force pushing destroys history
2. **NEVER use `git reset --hard`** - This permanently destroys local changes and commits
3. **ALL git push commands require EXPLICIT user authorization**
4. **Use revert commits instead of force push or reset** - To undo changes, create revert commits
5. **If you need to overwrite remote**, explain consequences and get explicit confirmation

**IMPORTANT**: NEVER commit or push changes without explicit user instruction

- Only run `git add`, `git commit`, or `git push` when the user explicitly asks
- Common explicit instructions include: "commit", "push", "commit and push", "save to git"
- Always wait for user approval before making any git operations

**NEW BRANCH REQUIREMENT**: ALL changes must be made on a new feature branch, never directly on main.

When the user asks you to commit and push:

1. Run `./scripts/format-all.sh` to format all files with Prettier
2. Run `./scripts/lint-all.sh` to ensure code passes linting
3. Follow the git commit guidelines in the main Claude system prompt
4. Get explicit user confirmation before any `git push`

**VERSION UPDATES**: Whenever committing changes, you MUST increment the patch version in package.json files.

## Code Patterns

### Tinqer Query Pattern

Use Tinqer for type-safe database queries:

```typescript
import { createSchema } from "@webpods/tinqer";
import { executeSelect, executeInsert } from "@webpods/tinqer-sql-pg-promise";

const schema = createSchema<DatabaseSchema>();

// ✅ Good - Type-safe select
const runs = await executeSelect(
  ctx.db,
  schema,
  (q, p) =>
    q
      .from("run")
      .where((r) => r.flow_name === p.flowName && r.status === p.status),
  { flowName, status },
);

// ✅ Good - Type-safe insert
const [newRun] = await executeInsert(
  ctx.db,
  schema,
  (q, p) =>
    q.insertInto("run").values({
      id: p.id,
      flow_name: p.flowName,
      status: p.status,
      created_at: p.createdAt,
    }),
  { id, flowName, status, createdAt },
);
```

### Repository Pattern

Abstract database differences between PostgreSQL and SQLite:

```typescript
// ✅ Good - Repository interface
export interface RunRepository {
  createRun(input: CreateRunInput): Promise<Result<Run, Error>>;
  getRun(id: string): Promise<Result<Run | null, Error>>;
  listRuns(filters: RunFilters): Promise<Result<Run[], Error>>;
}

// PostgreSQL implementation using Tinqer
export function createPostgresRunRepository(db: IDatabase<any>): RunRepository {
  // Implementation using @webpods/tinqer-sql-pg-promise
}

// SQLite implementation using Tinqer
export function createSqliteRunRepository(db: Database): RunRepository {
  // Implementation using @webpods/tinqer-sql-better-sqlite3
}
```

### Domain Function Pattern

```typescript
// ✅ Good - Pure function with Result type
export async function createRun(
  repo: RunRepository,
  input: CreateRunInput,
): Promise<Result<Run, Error>> {
  try {
    // Validate inputs
    if (!input.flowName) {
      return failure(new Error("Flow name is required"));
    }

    // Call repository
    const result = await repo.createRun(input);
    return result;
  } catch (error) {
    return failure(error as Error);
  }
}
```

### REST Route Pattern

```typescript
// ✅ Good - Zod validation, proper error handling
router.post("/", authenticate, async (req, res) => {
  try {
    const input = createRunSchema.parse(req.body);
    const result = await createRun(ctx.runRepository, input);

    if (!result.success) {
      res.status(400).json({ error: result.error.message });
      return;
    }

    res.status(201).json(result.data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.errors });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});
```

### Client Usage Pattern

```typescript
// ✅ Good - Always check Result.success
const result = await maxq.createRun({
  flowName: "market-analysis",
  input: {
    /* data */
  },
});

if (!result.success) {
  logger.error("Failed to create run", result.error);
  return;
}

const run = result.data;
```

## Key Data Model Concepts

### Runs

- Top-level execution instance of a flow
- Contains input data and metadata
- Tracks overall status (pending, running, completed, failed)
- Links to flow name (discovered from filesystem)

### Stages

- Named batch of steps (e.g., "data-fetch", "analysis")
- Scheduled together with dependencies
- Final stage marked with `final: true`
- Triggers flow callback when completed

### Steps

- Individual units of work within a stage
- Shell scripts executed as processes
- Support parallel execution via instances/sequences
- Can depend on other steps (DAG)
- Produce artifacts namespaced by step name and sequence

### Artifacts

- Data produced by steps
- JSON storage in database
- Namespaced as `stepName[sequence]/artifactName`
- Retrieved by later steps via HTTP API

### Flow Discovery

- No registration API - discovered from filesystem
- Flow location: `{FLOWS_ROOT}/{flowName}/flow.sh`
- Step location: `{FLOWS_ROOT}/{flowName}/steps/{stepName}/step.sh`
- MaxQ spawns processes with environment variables

## Testing & Development Optimization

### Test Output Strategy

**For full test suites (3+ minutes)**, use `tee` to display output AND save to file:

```bash
# Create .tests directory if it doesn't exist (gitignored)
mkdir -p .tests

# Run full test suite with tee - shows output to user AND saves to file
npm test | tee .tests/run-$(date +%s).txt

# Then analyze saved output without re-running tests:
grep "failing" .tests/run-*.txt
tail -50 .tests/run-*.txt
grep -A10 "specific test name" .tests/run-*.txt
```

**NEVER use plain redirection (`>` or `2>&1`)** - use `tee` for real-time output visibility.

### Analysis Working Directory

**For long-running analysis, research, or documentation tasks**, use `.analysis/` directory:

```bash
# Create .analysis directory if it doesn't exist (gitignored)
mkdir -p .analysis

# Examples of analysis work:
# - Code complexity reports
# - API documentation generation
# - Dependency analysis
# - Performance profiling results
# - Architecture diagrams and documentation
# - Database schema analysis
# - Security audit reports
```

Benefits: Keeps analysis artifacts separate from source code, allows iterative work without cluttering repository.

### Build & Lint Workflow

**ALWAYS follow this sequence:**

1. Run `./scripts/lint-all.sh` first
2. Run `./scripts/build.sh`
3. **If build fails and you make changes**: You MUST run `./scripts/lint-all.sh` again before building

**TIP**: Use `./scripts/build.sh --no-format` during debugging sessions to skip prettier formatting for faster builds.

## Common Development Tasks

### Adding a New Domain Entity

1. Add types to `maxq-server/src/types.ts`
2. Create migration in `/database/maxq/migrations/`
3. Add mapper functions to `maxq-server/src/mappers.ts`
4. Create domain functions in `maxq-server/src/domain/[entity]/`
5. Add repository interface and implementations
6. Add routes in `maxq-server/src/routes/`
7. Update client in `maxq-client/src/index.ts`

### Adding a New API Endpoint

1. Define request/response types
2. Create Zod validation schemas
3. Implement domain function with Result type
4. Add route with authentication and validation
5. Add client method
6. Document in `/docs/specification.md`

### Database Changes

1. Create migration: `npm run migrate:maxq:make your_migration_name`
2. Edit migration file with up/down functions
3. Run migration: `npm run migrate:maxq:latest` (only when asked)
4. Update types and mappers accordingly

## API Response Formats

### Pagination

All list endpoints return paginated results:

```typescript
{
  data: T[],
  pagination: {
    total: number,
    limit: number,
    offset: number
  }
}
```

### Error Responses

- 400: Invalid request data or validation errors
- 401: Authentication required or invalid Bearer token
- 404: Resource not found
- 500: Internal server error

Error format:

```json
{
  "error": "Error message",
  "details": [] // Optional, for validation errors
}
```

## Workflow Execution Pattern

The core principle of MaxQ:

```typescript
// 1. Discover flow from filesystem
const flowPath = path.join(FLOWS_ROOT, flowName, "flow.sh");

// 2. Spawn flow process with environment variables
const env = {
  MAXQ_RUN_ID: runId,
  MAXQ_FLOW_NAME: flowName,
  MAXQ_API: apiUrl,
  MAXQ_COMPLETED_STAGE: lastCompletedStage, // Empty on first call
  MAXQ_FAILED_STAGE: failedStage,
};
const flowProcess = spawn(flowPath, [], { env });

// 3. Flow returns JSON with stages to schedule
const response = JSON.parse(flowOutput);

// 4. Schedule steps in stage
for (const step of response.steps) {
  scheduleStep(runId, response.stage, step);
}

// 5. When stage completes, callback flow again (unless final: true)
```

## Documentation References

- **Project Overview**: [README.md](../README.md)
- **Complete Specification**: [docs/specification.md](docs/specification.md) - HTTP API, database schema, workflow examples
- **Helper Library**: [docs/examples/lib/helpers.sh](docs/examples/lib/helpers.sh) - Bash functions for flows/steps
- **Working Example**: [docs/examples/market_analysis/](docs/examples/market_analysis/) - Complete multi-stage workflow
- **Tinqer Documentation**: [docs/external-dependencies/tinqer/llms.txt](docs/external-dependencies/tinqer/llms.txt)

## Debugging Tips

1. **Flow execution issues**: Check `FLOWS_ROOT` path and flow.sh permissions
2. **Step execution issues**: Verify step.sh exists and environment variables are passed
3. **Stage callback issues**: Check if stage is marked as final or if previous stage completed
4. **Artifact issues**: Verify namespacing (stepName[sequence]/artifactName)
5. **Database connection**: Check DATABASE_URL for PostgreSQL or SQLITE_PATH for SQLite
6. **Repository pattern**: Ensure correct repository implementation is injected

## Security Model

- Fully trusted environment behind firewall
- Simple Bearer token validation only
- Rate limiting on endpoints
- No permission checks - all authenticated users have full access
- Flow and step scripts run as server process user - ensure proper sandboxing in production
