/**
 * Workflow orchestrator - ties together flow and step execution
 * Manages the complete workflow lifecycle from run creation to completion
 */

import { createLogger } from "../lib/logger/index.js";
import type { ExecutorConfig } from "./types.js";
import { executeFlowInitial } from "./flow-executor.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeUpdate, executeSelect } from "@tinqerjs/better-sqlite3-adapter";
import type { Database } from "better-sqlite3";
import type { DatabaseSchema } from "../lib/db/index.js";
import type { StepProcessRegistry } from "./process-registry.js";

const logger = createLogger("maxq:executor:orchestrator");
const schema = createSchema<DatabaseSchema>();

/**
 * Active orchestrator promises registry
 * Used for testing to ensure all background jobs complete before cleanup
 */
const activeOrchestrators = new Set<Promise<void>>();

/**
 * Wait for all active orchestrators to complete
 * Used in tests to prevent race conditions during cleanup
 */
export async function waitForAllOrchestrators(): Promise<void> {
  if (activeOrchestrators.size > 0) {
    logger.debug("Waiting for active orchestrators", {
      count: activeOrchestrators.size,
    });
    await Promise.allSettled([...activeOrchestrators]);
  }
}

/**
 * Context for orchestrator operations
 */
export type OrchestratorContext = {
  db: Database;
  config: ExecutorConfig;
  apiUrl: string;
  processRegistry: StepProcessRegistry;
};

/**
 * Input for starting a workflow run
 */
export type StartRunInput = {
  runId: string;
  flowName: string;
};

/**
 * Start a workflow run
 * Executes the initial flow call and begins stage execution
 *
 * @param ctx - Orchestrator context
 * @param input - Run input
 */
export async function startRun(
  ctx: OrchestratorContext,
  input: StartRunInput,
): Promise<void> {
  const { runId, flowName } = input;

  logger.info("Starting run", { runId, flowName });

  // Create execution function
  const executeRun = async () => {
    try {
      // Update run status to running
      await updateRunStatus(ctx.db, runId, "running");

      // Execute initial flow call
      // Flow communicates via HTTP API (POST /runs/{runId}/steps)
      // stdout/stderr captured for debugging only
      const flowResult = await executeFlowInitial({
        runId,
        flowName,
        flowsRoot: ctx.config.flowsRoot,
        apiUrl: ctx.apiUrl,
        maxLogCapture: ctx.config.maxLogCapture,
        processRegistry: ctx.processRegistry,
      });

      // Store flow stdout/stderr for debugging
      await updateRunOutput(
        ctx.db,
        runId,
        flowResult.processResult.stdout,
        flowResult.processResult.stderr,
      );

      // Check flow exit code
      if (flowResult.processResult.exitCode !== 0) {
        logger.error("Flow execution failed", {
          runId,
          exitCode: flowResult.processResult.exitCode,
        });
        await updateRunStatus(ctx.db, runId, "failed");
        return;
      }

      logger.info("Flow initial call completed", { runId, flowName });

      // Check if any stages were scheduled
      // If no stages exist, the flow chose not to schedule any work
      // In this case, mark the run as completed immediately
      const stages = await executeSelect(
        ctx.db,
        schema,
        (q, p) => q.from("stage").where((s) => s.run_id === p.runId),
        { runId },
      );

      if (stages.length === 0) {
        logger.info("No stages scheduled, marking run as completed", { runId });
        await updateRunStatus(ctx.db, runId, "completed");

        // Also set completedAt timestamp
        await executeUpdate(
          ctx.db,
          schema,
          (q, p) =>
            q
              .update("run")
              .set({ completed_at: p.completedAt })
              .where((r) => r.id === p.runId),
          { runId, completedAt: Date.now() },
        );
      } else {
        // Flow scheduled stages via HTTP API - execution happens asynchronously
        // Run status will be updated when final stage completes
        logger.debug("Stages scheduled, execution continues asynchronously", {
          runId,
          stageCount: stages.length,
        });
      }
    } catch (error) {
      logger.error("Run failed with error", { runId, error });
      await updateRunStatus(ctx.db, runId, "failed");
      throw error;
    }
  };

  // Wrap in a promise that tracks itself
  const executionPromise = executeRun().finally(() => {
    // Always remove from active registry when done
    activeOrchestrators.delete(executionPromise);
  });

  // Register this orchestrator as active
  activeOrchestrators.add(executionPromise);

  // Return the promise so caller can await if needed
  return executionPromise;
}

// NOTE: Stage execution is now triggered by the HTTP API
// Flows call POST /runs/:runId/steps to schedule stages
// See handlers/runs/schedule-stage.ts

/**
 * Update run status in database
 * Sets startedAt when transitioning to "running"
 */
async function updateRunStatus(
  db: Database,
  runId: string,
  status: "pending" | "running" | "completed" | "failed",
): Promise<void> {
  // Set startedAt when transitioning to running per spec §8.1
  if (status === "running") {
    await executeUpdate(
      db,
      schema,
      (q, p) =>
        q
          .update("run")
          .set({ status: p.status, started_at: p.startedAt })
          .where((r) => r.id === p.runId),
      { runId, status, startedAt: Date.now() },
    );
  } else {
    await executeUpdate(
      db,
      schema,
      (q, p) =>
        q
          .update("run")
          .set({ status: p.status })
          .where((r) => r.id === p.runId),
      { runId, status },
    );
  }
}

/**
 * Update run stdout/stderr in database
 */
async function updateRunOutput(
  db: Database,
  runId: string,
  stdout: string,
  stderr: string,
): Promise<void> {
  await executeUpdate(
    db,
    schema,
    (q, p) =>
      q
        .update("run")
        .set({ stdout: p.stdout, stderr: p.stderr })
        .where((r) => r.id === p.runId),
    { runId, stdout, stderr },
  );
}

// NOTE: Step result storage is now handled by the schedule-stage handler
// See handlers/runs/schedule-stage.ts
