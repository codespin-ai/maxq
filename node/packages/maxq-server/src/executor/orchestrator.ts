/**
 * Workflow orchestrator - ties together flow and step execution
 * Manages the complete workflow lifecycle from run creation to completion
 */

import { createLogger } from "@codespin/maxq-logger";
import type { ExecutorConfig } from "./types.js";
import type { FlowResponse } from "./flow-executor.js";
import {
  executeFlowInitial,
  executeFlowStageCompleted,
  executeFlowStageFailed,
} from "./flow-executor.js";
import {
  executeStepsDAG,
  type StepExecutionResult,
  type StepDefinition,
} from "./step-executor.js";
import type { IDatabase } from "pg-promise";
import { createSchema } from "@webpods/tinqer";
import { executeUpdate as executeSqlUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "@codespin/maxq-db";

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
  db: IDatabase<unknown>;
  config: ExecutorConfig;
  apiUrl: string;
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
      const flowResult = await executeFlowInitial({
        runId,
        flowName,
        flowsRoot: ctx.config.flowsRoot,
        apiUrl: ctx.apiUrl,
        maxLogCapture: ctx.config.maxLogCapture,
      });

      // Store flow stdout/stderr
      await updateRunOutput(
        ctx.db,
        runId,
        flowResult.processResult.stdout,
        flowResult.processResult.stderr,
      );

      if (flowResult.processResult.exitCode !== 0) {
        logger.error("Flow execution failed", {
          runId,
          exitCode: flowResult.processResult.exitCode,
        });
        await updateRunStatus(ctx.db, runId, "failed");
        return;
      }

      if (!flowResult.response) {
        logger.error("Flow returned no response", { runId });
        await updateRunStatus(ctx.db, runId, "failed");
        return;
      }

      // Start executing stages
      await executeStages(ctx, runId, flowName, flowResult.response);
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

/**
 * Execute stages in sequence with callbacks
 * Continues until final stage is reached
 *
 * @param ctx - Orchestrator context
 * @param runId - Run ID
 * @param flowName - Flow name
 * @param initialResponse - Initial flow response
 */
async function executeStages(
  ctx: OrchestratorContext,
  runId: string,
  flowName: string,
  initialResponse: FlowResponse,
): Promise<void> {
  let currentResponse = initialResponse;
  let lastCompletedStage: string | undefined;

  while (true) {
    const stageName = currentResponse.stage;
    const isFinal = currentResponse.final || false;

    logger.info("Executing stage", { runId, stage: stageName, isFinal });

    try {
      // Create stage record
      const { v4: uuidv4 } = await import("uuid");
      const stageId = uuidv4();
      const now = Date.now();

      await ctx.db.none(
        `
        INSERT INTO stage (id, run_id, name, final, status, created_at)
        VALUES (\${id}, \${runId}, \${name}, \${final}, \${status}, \${createdAt})
      `,
        {
          id: stageId,
          runId,
          name: stageName,
          final: isFinal,
          status: "running",
          createdAt: now,
        },
      );

      logger.debug("Created stage record", { stageId, stageName });

      // Create step definitions map for lookup
      const stepDefsMap = new Map(
        currentResponse.steps.map((s) => [s.name, s]),
      );

      // Execute all steps in this stage
      await executeStepsDAG(
        currentResponse.steps,
        runId,
        flowName,
        stageName,
        ctx.config.flowsRoot,
        ctx.apiUrl,
        ctx.config.maxLogCapture,
        ctx.config.maxConcurrentSteps,
        async (result: StepExecutionResult) => {
          // Store step result in database
          const stepDef = stepDefsMap.get(result.name);
          if (stepDef) {
            await storeStepResult(
              ctx.db,
              runId,
              stageId,
              stageName,
              result,
              stepDef,
            );
          }
        },
      );

      // Mark stage as completed
      await ctx.db.none(
        `
        UPDATE stage
        SET status = \${status}, completed_at = \${completedAt}
        WHERE id = \${id}
      `,
        {
          id: stageId,
          status: "completed",
          completedAt: Date.now(),
        },
      );

      logger.info("Stage completed", { runId, stage: stageName });

      // If this is the final stage, mark run as completed
      if (isFinal) {
        logger.info("Final stage completed, run successful", { runId });
        await updateRunStatus(ctx.db, runId, "completed");
        return;
      }

      // Call flow with completed stage
      lastCompletedStage = stageName;
      const flowResult = await executeFlowStageCompleted({
        runId,
        flowName,
        flowsRoot: ctx.config.flowsRoot,
        apiUrl: ctx.apiUrl,
        maxLogCapture: ctx.config.maxLogCapture,
        completedStage: lastCompletedStage,
      });

      // Update flow stdout/stderr
      await updateRunOutput(
        ctx.db,
        runId,
        flowResult.processResult.stdout,
        flowResult.processResult.stderr,
      );

      if (flowResult.processResult.exitCode !== 0) {
        logger.error("Flow callback failed", {
          runId,
          exitCode: flowResult.processResult.exitCode,
        });
        await updateRunStatus(ctx.db, runId, "failed");
        return;
      }

      if (!flowResult.response) {
        logger.error("Flow callback returned no response", { runId });
        await updateRunStatus(ctx.db, runId, "failed");
        return;
      }

      currentResponse = flowResult.response;
    } catch (error) {
      logger.error("Stage execution failed", {
        runId,
        stage: stageName,
        error,
      });

      // Mark stage as failed
      const failedStageId = await ctx.db.oneOrNone<{ id: string }>(
        `
        SELECT id FROM stage
        WHERE run_id = \${runId} AND name = \${name}
        ORDER BY created_at DESC
        LIMIT 1
      `,
        { runId, name: stageName },
      );

      if (failedStageId) {
        await ctx.db.none(
          `
          UPDATE stage
          SET status = \${status}, completed_at = \${completedAt}
          WHERE id = \${id}
        `,
          {
            id: failedStageId.id,
            status: "failed",
            completedAt: Date.now(),
          },
        );
      }

      // Call flow with failed stage
      const flowResult = await executeFlowStageFailed({
        runId,
        flowName,
        flowsRoot: ctx.config.flowsRoot,
        apiUrl: ctx.apiUrl,
        maxLogCapture: ctx.config.maxLogCapture,
        failedStage: stageName,
      });

      // Update flow stdout/stderr
      await updateRunOutput(
        ctx.db,
        runId,
        flowResult.processResult.stdout,
        flowResult.processResult.stderr,
      );

      await updateRunStatus(ctx.db, runId, "failed");
      return;
    }
  }
}

/**
 * Update run status in database
 */
async function updateRunStatus(
  db: IDatabase<unknown>,
  runId: string,
  status: "pending" | "running" | "completed" | "failed",
): Promise<void> {
  await executeSqlUpdate(
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

/**
 * Update run stdout/stderr in database
 */
async function updateRunOutput(
  db: IDatabase<unknown>,
  runId: string,
  stdout: string,
  stderr: string,
): Promise<void> {
  await executeSqlUpdate(
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

/**
 * Store step execution result in database
 * Creates or updates step record with execution results
 */
async function storeStepResult(
  db: IDatabase<unknown>,
  runId: string,
  stageId: string,
  stageName: string,
  result: StepExecutionResult,
  stepDef: StepDefinition,
): Promise<void> {
  logger.debug("Storing step result", {
    runId,
    stageId,
    stageName,
    stepName: result.name,
    sequence: result.sequence,
    exitCode: result.processResult.exitCode,
    retryCount: result.retryCount,
  });

  const status = result.processResult.exitCode === 0 ? "completed" : "failed";
  const startedAt = Date.now() - result.processResult.durationMs;
  const completedAt = Date.now();

  // Check if step already exists
  const existing = await db.oneOrNone<{ id: string }>(
    `
    SELECT id FROM step
    WHERE run_id = \${runId}
    AND stage_id = \${stageId}
    AND name = \${name}
    AND sequence = \${sequence}
  `,
    {
      runId,
      stageId,
      name: result.name,
      sequence: result.sequence,
    },
  );

  if (existing) {
    // Update existing step
    await db.none(
      `
      UPDATE step
      SET status = \${status},
          retry_count = \${retryCount},
          started_at = \${startedAt},
          completed_at = \${completedAt},
          duration_ms = \${durationMs},
          stdout = \${stdout},
          stderr = \${stderr}
      WHERE id = \${id}
    `,
      {
        id: existing.id,
        status,
        retryCount: result.retryCount,
        startedAt,
        completedAt,
        durationMs: result.processResult.durationMs,
        stdout: result.processResult.stdout,
        stderr: result.processResult.stderr,
      },
    );
  } else {
    // Create new step
    const { v4: uuidv4 } = await import("uuid");
    await db.none(
      `
      INSERT INTO step (
        id, run_id, stage_id, name, sequence, status,
        depends_on, retry_count, max_retries, env,
        created_at, started_at, completed_at, duration_ms,
        stdout, stderr
      ) VALUES (
        \${id}, \${runId}, \${stageId}, \${name}, \${sequence}, \${status},
        \${dependsOn}, \${retryCount}, \${maxRetries}, \${env},
        \${createdAt}, \${startedAt}, \${completedAt}, \${durationMs},
        \${stdout}, \${stderr}
      )
    `,
      {
        id: uuidv4(),
        runId,
        stageId,
        name: result.name,
        sequence: result.sequence,
        status,
        dependsOn: JSON.stringify(stepDef.dependsOn || []),
        retryCount: result.retryCount,
        maxRetries: stepDef.maxRetries || 0,
        env: JSON.stringify(stepDef.env || {}),
        createdAt: startedAt,
        startedAt,
        completedAt,
        durationMs: result.processResult.durationMs,
        stdout: result.processResult.stdout,
        stderr: result.processResult.stderr,
      },
    );
  }
}
