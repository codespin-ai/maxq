/**
 * MaxQ main entry point
 * Exports types and utilities for programmatic use
 * Does NOT start the server on import - use CLI or call startServer() manually
 */

// Export types for use in tests and clients
export type {
  Run,
  Stage,
  Step,
  CreateRunInput,
  UpdateRunInput,
  UpdateStageInput,
  UpdateStepInput,
  PaginatedResult,
  ListRunsParams,
  ListStepsParams,
} from "./types.js";
export type { RunStatus, StageStatus, StepStatus } from "./lib/db/index.js";
export type { StepDefinition } from "./executor/step-executor.js";

// Export testing utilities
export { waitForAllOrchestrators } from "./executor/orchestrator.js";

// Export test-utils for integration tests
export * from "./lib/test-utils/index.js";

// Export executor modules for deep imports in tests
export * as flowExecutor from "./executor/flow-executor.js";
export * as stepExecutor from "./executor/step-executor.js";
export * as flowDiscovery from "./executor/flow-discovery.js";
export * as processSpawn from "./executor/process-spawn.js";
export * as security from "./executor/security.js";
export { StepProcessRegistry } from "./executor/process-registry.js";
