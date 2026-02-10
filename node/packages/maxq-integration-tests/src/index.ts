/**
 * MaxQ Integration Tests
 *
 * Import test setup and all test files
 */

import { setupGlobalHooks } from "./test-setup.js";

// Setup global before/after hooks
setupGlobalHooks();

// Chai setup
import "./chai-setup.js";

// API tests
import "./tests/runs.test.js";

// Workflow execution tests
import "./tests/workflow-execution.test.js";
import "./tests/cascade-failure.test.js";

// Scheduler tests
import "./tests/scheduler/scheduler.test.js";
import "./tests/scheduler/step-scheduler.test.js";
import "./tests/scheduler/concurrency-limit.test.js";

// Domain tests
import "./tests/domain/retry-run.test.js";
