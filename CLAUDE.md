# CLAUDE.md

**NEVER DEPLOY WITHOUT EXPLICIT USER INSTRUCTION**: Deployments to production are STRICTLY FORBIDDEN unless the user explicitly says to deploy. This is a live system with active users. No exceptions — never run deploy scripts, push to production, or trigger any deployment pipeline without a direct, explicit instruction from the user.

**sed USAGE**

NEVER USE sed TO BULK REPLACE
NEVER USE sed TO BULK REPLACE
NEVER USE sed TO BULK REPLACE
NEVER USE sed TO BULK REPLACE

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

### NEVER USE MULTIEDIT

**NEVER use the MultiEdit tool.** It has caused issues in multiple projects. Always use individual Edit operations instead, even if it means more edits. This ensures better control and prevents unintended changes.

### ALWAYS SAVE TEST OUTPUT TO LOG FILE

**🚨 CRITICAL RULE: ALWAYS pipe test output to a log file for later analysis. 🚨**

Tests in this project take 3+ minutes and cannot be quickly re-run. If you lose the output, you lose valuable debugging information.

**ALWAYS do this:**

```bash
# Run tests and save output to log file
npm test 2>&1 | tee .tests/test.log

# Then analyze the log in a separate step
grep -E "(failing|Error|FAIL)" .tests/test.log
```

**NEVER do this:**

```bash
# DON'T run tests without saving output
npm test 2>&1 | tail -10  # Output is LOST if interrupted!
```

**Why this matters:**

- Tests take 3+ minutes to run
- If the command is interrupted, ALL output is lost
- You cannot re-run quickly to see what failed
- The `.tests/` directory is gitignored, safe for logs

### USE DEDICATED TOOLS FOR FILE OPERATIONS

**IMPORTANT**: Always use the dedicated tools instead of bash commands for file operations:

- **Read files**: Use the `Read` tool, NOT `cat`, `head`, or `tail`
- **Edit files**: Use the `Edit` tool, NOT `sed` or `awk`
- **Create files**: Use the `Write` tool, NOT `cat` with heredoc or `echo` redirection
- **Search files**: Use the `Grep` tool, NOT `grep` or `rg` commands
- **Find files**: Use the `Glob` tool, NOT `find` or `ls`

Reserve bash exclusively for actual system commands (git, npm, etc.) that require shell execution.

### FINISH DISCUSSIONS BEFORE WRITING CODE

**IMPORTANT**: When the user asks a question or you're in the middle of a discussion, DO NOT jump to writing code. Always:

1. **Complete the discussion first** - Understand the problem fully
2. **Analyze and explain** - Work through the issue verbally
3. **Get confirmation** - Ensure the user agrees with the approach
4. **Only then write code** - After the user explicitly asks you to implement

### ANSWER QUESTIONS AND STOP

**CRITICAL RULE**: If the user asks you a question - whether as part of a larger text or just the question itself - you MUST:

1. **Answer ONLY that question**
2. **STOP your response completely**
3. **DO NOT continue with any other tasks or implementation**
4. **DO NOT proceed with previous tasks**
5. **Wait for the user's next instruction**

This applies to ANY question, even if it seems like part of a larger task or discussion.

### NO WORKAROUNDS - STOP AND FIX

**CRITICAL RULE**: When you encounter a bug or issue, do NOT implement workarounds or temporary fixes.

- **NEVER** say "for now, let's..." and implement a hack
- **NEVER** work around a problem with a different approach just to make progress
- **NEVER** use escape hatches like `as unknown as X` to bypass type errors
- **ALWAYS** stop and report the issue clearly
- **ALWAYS** wait for direction on whether to fix the root cause or defer

When you hit a blocker:

1. Explain exactly what the issue is
2. Explain why it's happening (root cause)
3. Stop and ask for direction

Workarounds hide problems and create technical debt. The correct response to a bug is to fix it or explicitly defer it - never to silently work around it.

### NEVER COMMIT DIRECTLY TO MAIN

**CRITICAL**: ALL changes must be made on a feature branch, never directly on main.

- Always create a new branch before making changes (e.g., `feature/add-reporting`, `fix/auction-notifications`)
- Push the feature branch and create a pull request
- Only merge to main after user approval

### NEVER COMMIT WITHOUT ALL TESTS PASSING

**CRITICAL**: ALL tests must pass in BOTH local mode AND Docker Compose mode before committing.

- Run `./scripts/test-integration.sh local` and verify all tests pass
- Run `./scripts/test-integration.sh compose` and verify all tests pass in Docker
- If Docker Compose tests fail due to schema changes, rebuild Docker images first: `./scripts/docker-build.sh`
- No exceptions - if tests fail, fix them before committing

### NEVER BLAME "PRE-EXISTING FAILURES"

**CRITICAL**: The excuse "these are pre-existing failures" is NEVER acceptable.

- If tests fail, they must be fixed - period
- If you introduced code that breaks tests, fix your code
- If tests were already broken before your changes, fix those tests too
- The codebase must always be in a clean, passing state
- "It was already broken" is not a valid excuse for leaving things broken

### Monitoring Long-Running Operations

When running background operations like deploys, builds, or tests:

- **Check output at most every 30 seconds** - Do not poll in a tight loop
- **Be patient with slow operations** - Docker builds and deploys take time
- **Report progress periodically** - Let the user know when operations complete

### Linting and Code Quality Standards

**CRITICAL**: NEVER weaken linting, testing, or type-checking rules:

- **NO eslint-disable comments** - Fix the actual issues instead of suppressing warnings
- **NO test.skip or test.only in committed code** - All tests must run and pass
- **NO @ts-expect-error or @ts-ignore** - Fix type errors properly
- **NO relaxing TypeScript strict mode** - Maintain full type safety
- **NO lowering code coverage thresholds** - Improve coverage instead
- **NO weakening any quality gates** - Standards exist for a reason

When you encounter linting, type, or test errors, the solution is ALWAYS to fix the underlying issue properly, never to suppress or bypass the error. Quality standards are non-negotiable.

### NEVER USE AUTOMATED SCRIPTS FOR FIXES

**🚨 CRITICAL RULE: NEVER EVER attempt automated fixes via scripts or mass updates. 🚨**

- **NEVER** create scripts to automate replacements (JS, Python, shell, etc.)
- **NEVER** use sed, awk, grep, or other text processing tools for bulk changes
- **NEVER** write code that modifies multiple files automatically
- **ALWAYS** make changes manually using the Edit tool
- **Even if there are hundreds of similar changes, do them ONE BY ONE**

Automated scripts break syntax in unpredictable ways and destroy codebases.

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

**Functional Programming Rules:**

- **NO MUTABLE VARIABLES** - Only use `const`, never `let` or `var`
- **NO MUTATIONS** - Never modify objects/arrays, always create new ones
- **PURE FUNCTIONS ONLY** - No side effects except necessary I/O
- **EXPLICIT DEPENDENCIES** - All dependencies passed as parameters

If you write mutable code, you MUST immediately rewrite it functionally.

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

- **SQLite database** with **Tinqer** for type-safe queries
- **Knex.js** for migrations
- Table names: **singular** and **snake_case** (e.g., `run`, `step`, `artifact`)
- TypeScript: **camelCase** for all variables/properties
- SQL: **snake_case** for all table/column names
- **DbRow Pattern**: All persistence functions use `XxxDbRow` types that mirror exact database schema
- **Mapper Functions**: `mapXxxFromDb()` and `mapXxxToDb()` handle conversions between snake_case DB and camelCase domain types
- **JSON Handling**: SQLite stores JSON as TEXT, requiring parsing on read and stringification on write

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
./scripts/docker-build.sh       # Build Docker images (migrations + production)
./scripts/docker-test.sh        # Test Docker image
./scripts/docker-push.sh        # Push to GHCR

# Integration testing
./scripts/test-integration.sh local    # Run tests locally
./scripts/test-integration.sh compose  # Run tests with Docker Compose

# Service management
./scripts/stop-all.sh           # Stop all MaxQ services and free ports
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

#### NEVER SWITCH BRANCHES WITHOUT PERMISSION

**🚨 CRITICAL RULE: NEVER switch git branches unless the user explicitly tells you to. 🚨**

- **NEVER** run `git checkout <branch>` to switch branches on your own
- **NEVER** run `git switch <branch>` without explicit user instruction
- **ALWAYS** stay on the current branch until told otherwise
- **ALWAYS** complete all work on the current branch before switching

If you need to switch branches for any reason, **ASK THE USER FIRST**.

#### Critical Git Safety Rules

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

#### NEVER DISCARD UNCOMMITTED WORK

**🚨 CRITICAL RULE: NEVER use commands that permanently delete uncommitted changes. 🚨**

These commands cause **PERMANENT DATA LOSS** that cannot be recovered:

- **NEVER** use `git reset --hard`
- **NEVER** use `git reset --soft`
- **NEVER** use `git reset --mixed`
- **NEVER** use `git reset HEAD`
- **NEVER** use `git checkout -- .`
- **NEVER** use `git checkout -- <file>`
- **NEVER** use `git restore` to discard changes
- **NEVER** use `git clean -fd`

**Why this matters for AI sessions:**

- Uncommitted work is invisible to future AI sessions
- Once discarded, changes cannot be recovered
- AI cannot help fix problems it cannot see

**What to do instead:**

| Situation               | ❌ WRONG                            | ✅ CORRECT                         |
| ----------------------- | ----------------------------------- | ---------------------------------- |
| Need to switch branches | `git checkout main` (loses changes) | Commit first, then switch          |
| Made mistakes           | `git reset --hard`                  | Commit to temp branch, start fresh |
| Want clean slate        | `git restore .`                     | Commit current state, then revert  |
| On wrong branch         | `git checkout --`                   | Commit here, then cherry-pick      |

#### NEVER USE GIT STASH

**🚨 CRITICAL RULE: NEVER use git stash - it hides work and causes data loss. 🚨**

- **NEVER** use `git stash`
- **NEVER** use `git stash push`
- **NEVER** use `git stash pop`
- **NEVER** use `git stash apply`
- **NEVER** use `git stash drop`

**Why stash is dangerous:**

- Stashed changes are invisible to AI sessions
- Easy to forget what's stashed
- Stash can be accidentally dropped
- Causes merge conflicts when applied
- No clear history of when/why stashed

**What to do instead - Use WIP branches:**

```bash
# Instead of stash, create a timestamped WIP branch
git checkout -b wip/feature-name-$(date +%Y%m%d-%H%M%S)
git add -A
git commit -m "wip: in-progress work on feature X"
git push -u origin wip/feature-name-$(date +%Y%m%d-%H%M%S)

# Now switch to other work safely
git checkout main
# ... do other work ...

# Return to your WIP later
git checkout wip/feature-name-20251108-084530
# Continue working...
```

**Benefits of WIP branches over stash:**

- ✅ Work is visible in git history
- ✅ Work is backed up on remote
- ✅ AI can see the work in future sessions
- ✅ Can have multiple WIP branches
- ✅ Clear timestamps show when work was done

#### Safe Branch Switching

**ALWAYS commit before switching branches:**

```bash
# Check current status
git status

# If there are changes, commit them first
git add -A
git commit -m "wip: current state before switching"

# NOW safe to switch
git checkout other-branch
```

**If you accidentally started work on wrong branch:**

```bash
# DON'T use git reset or git checkout --
# Instead, commit the work here
git add -A
git commit -m "wip: work started on wrong branch"

# Create correct branch from current state
git checkout -b correct-branch-name

# Previous branch will still have the commit
# You can cherry-pick it or just continue on new branch
```

#### Recovery from Mistakes

If you realize you made a mistake AFTER committing:

```bash
# ✅ CORRECT: Create a fix commit
git commit -m "fix: correct the mistake from previous commit"

# ✅ CORRECT: Revert the bad commit
git revert HEAD

# ❌ WRONG: Try to undo with reset
git reset --hard HEAD~1  # NEVER DO THIS - loses history
```

**If you accidentally committed to main:**

```bash
# DON'T panic or use git reset
# Just create a feature branch from current position
git checkout -b feat/your-feature-name

# Push the branch
git push -u origin feat/your-feature-name

# When merged, it will fast-forward (no conflicts)
```

#### Pull Requests

**NEVER create pull requests using `gh pr create` or similar CLI commands.**

The user will create all pull requests manually through the GitHub web interface. Your job is to:

1. Create feature branches
2. Commit changes
3. Push branches to remote
4. **STOP** - Do not create PRs

## Code Patterns

### Tinqer Query Pattern

Use Tinqer for type-safe database queries:

```typescript
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect, executeInsert } from "@tinqerjs/better-sqlite3-adapter";

const schema = createSchema<DatabaseSchema>();

// ✅ Good - Type-safe select
const runs = executeSelect(
  ctx.db,
  schema,
  (q, p) =>
    q
      .from("run")
      .where((r) => r.flow_name === p.flowName && r.status === p.status),
  { flowName, status },
);

// ✅ Good - Type-safe insert (returns row count in SQLite)
const rowCount = executeInsert(
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

// Note: SQLite executeInsert returns row count, not data.
// Use a follow-up SELECT to retrieve the inserted row.
```

### SQLite Implementation Pattern

SQLite-specific considerations in the codebase:

```typescript
// ✅ Good - JSON field handling for SQLite
// SQLite stores JSON as TEXT, so parse on read:
const dependsOn = typeof dependsOnRaw === "string"
  ? JSON.parse(dependsOnRaw)
  : dependsOnRaw || [];

// And stringify on write:
const input = data.input ? JSON.stringify(data.input) : null;

// ✅ Good - INSERT pattern for SQLite (no RETURNING clause)
const rowCount = executeInsert(ctx.db, schema, ...);
if (rowCount === 0) {
  return failure(new Error("Failed to insert"));
}
// Follow-up SELECT to get the inserted data
const rows = executeSelect(ctx.db, schema,
  (q, p) => q.from("table").where((t) => t.id === p.id),
  { id }
);
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

## Working Directories

**IMPORTANT**: Never create temporary files in the project root or package directories. Use dedicated gitignored directories for different purposes.

**Note:** All four directories (`.tests/`, `.analysis/`, `.todos/`, `.temp/`) are gitignored for safe local use.

### .tests/ Directory (Test Output Capture)

**Purpose:** Save test run output for analysis without re-running tests.

See **ALWAYS SAVE TEST OUTPUT TO LOG FILE** in Critical Guidelines for the mandatory rule.

```bash
# Create directory (gitignored)
mkdir -p .tests

# Use timestamped filenames for multiple runs
npm test 2>&1 | tee .tests/run-$(date +%s).txt

# Analyze saved output without re-running tests:
grep "failing" .tests/run-*.txt
tail -50 .tests/run-*.txt
grep -A10 "specific test name" .tests/run-*.txt
```

### .analysis/ Directory (Research & Documentation)

**Purpose:** Keep analysis artifacts separate from source code.

```bash
# Create directory (gitignored)
mkdir -p .analysis

# Use for:
# - Code complexity reports
# - API documentation generation
# - Dependency analysis
# - Performance profiling results
# - Architecture diagrams and documentation
# - Database schema analysis
# - Security audit reports
```

### .temp/ Directory (Temporary Scripts & Debugging)

**Purpose:** Store temporary scripts and one-off debugging files.

```bash
# Create directory (gitignored)
mkdir -p .temp

# Use for:
# - Quick test scripts
# - Debug output files
# - One-off data transformations
# - Temporary TypeScript/JavaScript for testing

# NEVER use /tmp or system temp directories
# .temp keeps files visible and within the project
```

**Key Rule:** ALWAYS use `.temp/` instead of `/tmp/` or system temp directories. This keeps temporary work visible and accessible within the project.

### .todos/ Directory (Persistent Task Tracking)

**Purpose:** Track multi-step tasks across conversation sessions.

See **Task Management with .todos Directory** in Session Startup section for detailed usage.

## Build & Lint Workflow

**ALWAYS follow this sequence:**

1. Run `./scripts/lint-all.sh` first
2. Run `./scripts/build.sh`
3. **If build fails and you make changes**: You MUST run `./scripts/lint-all.sh` again before building

**TIP**: Use `./scripts/build.sh --no-format` during debugging sessions to skip prettier formatting for faster builds.

## Common Development Tasks

### Adding a New Domain Entity

1. Add types to `maxq/src/types/`
2. Create migration: `npm run migrate:maxq:make migration_name`
3. Edit migration file in `database/maxq/migrations/`
4. Create domain functions in `maxq/src/domain/`
5. Add repository interface and implementations
6. Add routes in `maxq/src/routes/`

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
5. **Database connection**: Check MAXQ_DATA_DIR environment variable for data directory path
6. **JSON fields**: Ensure JSON fields are parsed from TEXT (SQLite stores JSON as TEXT)

## Security Model

- Fully trusted environment behind firewall
- Simple Bearer token validation only
- Rate limiting on endpoints
- No permission checks - all authenticated users have full access
- Flow and step scripts run as server process user - ensure proper sandboxing in production
