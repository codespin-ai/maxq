/**
 * Step scheduler - background loop that picks pending steps and executes them
 * Implements scheduler-driven execution model with dependency resolution
 */

import { createLogger } from "@codespin/maxq-logger";
import { createSchema } from "@webpods/tinqer";
import { executeSelect, executeUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "@codespin/maxq-db";
import type { DataContext } from "../domain/data-context.js";
import { executeStep } from "../executor/step-executor.js";
import { updateStep } from "../domain/step/update-step.js";
import { updateStage } from "../domain/stage/update-stage.js";
import { updateRun } from "../domain/run/update-run.js";
import {
  executeFlowStageCompleted,
  executeFlowStageFailed,
} from "../executor/flow-executor.js";
import { hostname } from "os";

const logger = createLogger("maxq:scheduler");
const schema = createSchema<DatabaseSchema>();

/**
 * Scheduler configuration
 */
export type SchedulerConfig = {
  intervalMs: number; // How often to check for pending steps
  batchSize: number; // Max steps to claim per iteration
  workerId: string; // Worker identifier (hostname by default)
};

/**
 * Active scheduler handle
 */
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the step scheduler
 * Runs a background loop that picks pending steps and executes them
 *
 * @param ctx - Data context
 * @param config - Scheduler configuration
 */
export function startScheduler(
  ctx: DataContext,
  config?: Partial<SchedulerConfig>,
): void {
  const fullConfig: SchedulerConfig = {
    intervalMs: parseInt(process.env.MAXQ_SCHEDULER_INTERVAL_MS || "200", 10),
    batchSize: parseInt(process.env.MAXQ_SCHEDULER_BATCH_SIZE || "10", 10),
    workerId: config?.workerId || hostname(),
    ...config,
  };

  logger.info("Starting step scheduler", fullConfig);

  // Stop existing scheduler if running
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  // Start scheduler loop
  schedulerInterval = setInterval(async () => {
    try {
      await pickAndClaimSteps(ctx, fullConfig);
    } catch (error) {
      logger.error("Scheduler iteration failed", { error });
    }
  }, fullConfig.intervalMs);
}

/**
 * Stop the step scheduler
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    logger.info("Stopping step scheduler");
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/**
 * Pick pending steps that are ready to execute and claim them
 * A step is ready if:
 * - status = 'pending'
 * - all dependencies are completed
 * - run is not terminated
 * IMPORTANT: Respects maxConcurrentSteps limit
 *
 * @param ctx - Data context
 * @param config - Scheduler configuration
 */
async function pickAndClaimSteps(
  ctx: DataContext,
  config: SchedulerConfig,
): Promise<void> {
  const now = Date.now();

  // First, count how many steps are currently running
  const runningSteps = await executeSelect(
    ctx.db,
    schema,
    (q) =>
      q
        .from("step")
        .where((s) => s.status === "running")
        .select((s) => ({ id: s.id })),
    {},
  );

  const currentlyRunning = runningSteps.length;
  const maxConcurrentSteps = ctx.executor.config.maxConcurrentSteps;

  // Calculate how many more steps we can claim
  const availableSlots = maxConcurrentSteps - currentlyRunning;

  if (availableSlots <= 0) {
    logger.debug("Max concurrent steps reached", {
      currentlyRunning,
      maxConcurrentSteps,
    });
    return; // Already at max capacity
  }

  // Only query for as many pending steps as we have capacity for
  const queryLimit = Math.min(config.batchSize, availableSlots);

  // Query for pending steps (up to our available capacity)
  const allPendingSteps = await executeSelect(
    ctx.db,
    schema,
    (q, p) =>
      q
        .from("step")
        .where((s) => s.status === "pending")
        .take(p.queryLimit),
    { queryLimit },
  );

  if (allPendingSteps.length === 0) {
    return; // No work to do
  }

  // Filter out steps from terminated or paused runs
  // For each pending step, check if its run is active (not terminated and not paused)
  const pendingSteps = [];
  for (const step of allPendingSteps) {
    const runs = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("run")
          .where((r) => r.id === p.runId)
          .select((r) => ({
            id: r.id,
            flow_name: r.flow_name,
            status: r.status,
            termination_reason: r.termination_reason,
          })),
      { runId: step.run_id },
    );

    if (
      runs.length > 0 &&
      runs[0]!.termination_reason === null &&
      runs[0]!.status !== "paused"
    ) {
      // Run exists, is not terminated, and is not paused
      pendingSteps.push({
        step,
        run: runs[0]!,
      });
    }
  }

  if (pendingSteps.length === 0) {
    return; // No work to do after filtering terminated runs
  }

  logger.debug("Found pending steps", { count: pendingSteps.length });

  // Track how many steps we've claimed in this iteration
  let claimedCount = 0;

  // Check each step's dependencies
  for (const stepRow of pendingSteps) {
    // Check if we've hit the limit for this iteration
    if (claimedCount >= availableSlots) {
      logger.debug("Reached capacity limit for this iteration", {
        claimedCount,
        availableSlots,
      });
      break;
    }
    const stepId = stepRow.step.id;
    const runId = stepRow.step.run_id;
    const stageId = stepRow.step.stage_id;
    const stepName = stepRow.step.name;
    const dependsOn = (stepRow.step.depends_on as unknown as string[]) || [];
    const flowName = stepRow.run.flow_name;
    const maxRetries = stepRow.step.max_retries;
    const env = stepRow.step.env as unknown as Record<string, string> | null;

    // Check if all dependencies are completed
    if (dependsOn.length > 0) {
      // Get all steps for this run to check dependencies
      const allStepsInRun = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("step")
            .where((s) => s.run_id === p.runId)
            .select((s) => ({
              id: s.id,
              status: s.status,
            })),
        { runId },
      );

      // Filter to only dependency steps
      const dependencySteps = allStepsInRun.filter((s) =>
        dependsOn.includes(s.id),
      );

      // Check if all dependencies exist and are completed
      const completedDeps = dependencySteps.filter(
        (d) => d.status === "completed",
      );
      if (completedDeps.length !== dependsOn.length) {
        logger.debug("Step dependencies not ready, skipping", {
          stepId,
          dependsOn,
          completedCount: completedDeps.length,
          requiredCount: dependsOn.length,
        });
        continue; // Skip this step
      }
    }

    // Try to claim this step atomically
    const claimed = await claimStep(ctx, stepId, config.workerId, now);

    if (claimed) {
      // Successfully claimed - execute the step
      claimedCount++;
      logger.info("Claimed step for execution", {
        stepId,
        stepName,
        runId,
        stageId,
        claimedCount,
        maxConcurrentSteps,
      });

      // Get stage name for execution context
      const stages = await executeSelect(
        ctx.db,
        schema,
        (q, p) => q.from("stage").where((s) => s.id === p.stageId),
        { stageId },
      );

      if (stages.length === 0) {
        logger.error("Stage not found for step", { stepId, stageId });
        continue;
      }

      const stageName = stages[0]!.name;

      // Execute step asynchronously (don't await - let scheduler continue)
      executeStepWithRetry(ctx, {
        stepId,
        stepName,
        runId,
        flowName,
        stageId,
        stageName,
        maxRetries,
        env: env || undefined,
      }).catch(async (error) => {
        logger.error("Step execution failed", { stepId, error });

        // Mark step as failed to prevent infinite retry loop
        try {
          await updateStep(ctx, stepId, {
            status: "failed",
            completedAt: Date.now(),
            stderr: `Execution error: ${error.message || "Unknown error"}`,
          });

          // Cascade failure to dependent steps
          await cascadeFailure(ctx, runId, stageId, stepId);

          // Check if stage is complete after marking step as failed
          await checkStageCompletion(ctx, runId, stageId, stageName, flowName);
        } catch (updateError) {
          logger.error("Failed to mark step as failed after error", {
            stepId,
            updateError,
          });
        }
      });
    }
  }
}

/**
 * Atomically claim a step for execution
 * Uses optimistic locking to ensure only one worker claims the step
 *
 * @param ctx - Data context
 * @param stepId - Step ID to claim
 * @param workerId - Worker identifier
 * @param now - Current timestamp
 * @returns true if claimed successfully
 */
async function claimStep(
  ctx: DataContext,
  stepId: string,
  workerId: string,
  now: number,
): Promise<boolean> {
  const result = await executeUpdate(
    ctx.db,
    schema,
    (q, p) =>
      q
        .update("step")
        .set({
          status: "running",
          claimed_at: p.claimedAt,
          worker_id: p.workerId,
          heartbeat_at: p.heartbeatAt,
          started_at: p.startedAt,
        })
        .where((s) => s.id === p.stepId && s.status === "pending"),
    {
      stepId,
      claimedAt: now,
      workerId,
      heartbeatAt: now,
      startedAt: now,
    },
  );

  return result > 0;
}

/**
 * Step execution context
 */
type StepExecutionContext = {
  stepId: string;
  stepName: string;
  runId: string;
  flowName: string;
  stageId: string;
  stageName: string;
  maxRetries: number;
  env?: Record<string, string>;
};

/**
 * Execute a step with retry logic
 * Handles step completion and stage completion checks
 *
 * @param ctx - Data context
 * @param execCtx - Step execution context
 */
async function executeStepWithRetry(
  ctx: DataContext,
  execCtx: StepExecutionContext,
): Promise<void> {
  const {
    stepId,
    stepName,
    runId,
    flowName,
    stageId,
    stageName,
    maxRetries,
    env,
  } = execCtx;

  let retryCount = 0;

  // Retry loop
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    retryCount = attempt;

    if (attempt > 0) {
      logger.info("Retrying step", {
        stepId,
        stepName,
        attempt,
        maxRetries,
      });
    }

    // Execute the step
    const processResult = await executeStep({
      runId,
      flowName,
      stage: stageName,
      stepId,
      stepName,
      flowsRoot: ctx.executor.config.flowsRoot,
      apiUrl: ctx.executor.apiUrl,
      maxLogCapture: ctx.executor.config.maxLogCapture,
      processRegistry: ctx.executor.processRegistry,
      env,
    });

    // Determine status from exit code
    const status = processResult.exitCode === 0 ? "completed" : "failed";

    // Update step with execution results
    const updateResult = await updateStep(ctx, stepId, {
      status,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      retryCount,
      completedAt: Date.now(),
    });

    if (!updateResult.success) {
      logger.error("Failed to update step after execution", {
        stepId,
        error: updateResult.error,
      });
    }

    // If successful, break out of retry loop
    if (status === "completed") {
      logger.info("Step completed successfully", { stepId, stepName });
      break;
    }

    // If failed and no more retries, break
    if (attempt >= maxRetries) {
      logger.error("Step failed after all retries", {
        stepId,
        stepName,
        retries: retryCount,
      });
      break;
    }
  }

  // Check the final status of the step
  const steps = await executeSelect(
    ctx.db,
    schema,
    (q, p) =>
      q
        .from("step")
        .where((s) => s.id === p.stepId)
        .select((s) => ({ status: s.status })),
    { stepId },
  );

  const finalStatus = steps[0]?.status;

  // If step failed, cascade failure to all dependent steps
  if (finalStatus === "failed") {
    await cascadeFailure(ctx, runId, stageId, stepId);
  }

  // Check if all steps in the stage are complete
  await checkStageCompletion(ctx, runId, stageId, stageName, flowName);
}

/**
 * Cascade failure to all dependent steps
 * When a step fails, mark all steps that depend on it (directly or transitively) as failed
 *
 * @param ctx - Data context
 * @param runId - Run ID
 * @param stageId - Stage ID
 * @param failedStepId - The step that failed
 */
async function cascadeFailure(
  ctx: DataContext,
  _runId: string,
  stageId: string,
  failedStepId: string,
): Promise<void> {
  // Get all steps in this stage
  const allSteps = await executeSelect(
    ctx.db,
    schema,
    (q, p) =>
      q
        .from("step")
        .where((s) => s.stage_id === p.stageId)
        .select((s) => ({
          id: s.id,
          status: s.status,
          depends_on: s.depends_on,
        })),
    { stageId },
  );

  // Build a set of failed step IDs (starting with the initial failed step)
  const failedStepIds = new Set<string>([failedStepId]);

  // Track which steps we've already marked as failed
  const processedStepIds = new Set<string>();

  // Keep iterating until no new failed steps are found
  let foundNewFailures = true;
  while (foundNewFailures) {
    foundNewFailures = false;

    for (const step of allSteps) {
      // Skip if already processed or if already terminal
      if (
        processedStepIds.has(step.id) ||
        step.status === "failed" ||
        step.status === "completed"
      ) {
        continue;
      }

      // Check if this step depends on any failed step
      const dependsOn = (step.depends_on as unknown as string[]) || [];
      const dependsOnFailedStep = dependsOn.some((depId) =>
        failedStepIds.has(depId),
      );

      if (dependsOnFailedStep) {
        // Mark this step as failed
        logger.info("Cascading failure to dependent step", {
          stepId: step.id,
          failedDependency: failedStepId,
        });

        await updateStep(ctx, step.id, {
          status: "failed",
          completedAt: Date.now(),
          stderr: `Skipped: dependency '${failedStepId}' failed`,
        });

        // Track that we've processed this step
        processedStepIds.add(step.id);
        // Add to failed set for transitive dependencies
        failedStepIds.add(step.id);
        foundNewFailures = true;
      }
    }
  }
}

/**
 * Check if all steps in a stage are complete
 * If complete, mark stage as completed/failed and trigger flow callback
 *
 * @param ctx - Data context
 * @param runId - Run ID
 * @param stageId - Stage ID
 * @param stageName - Stage name
 * @param flowName - Flow name
 */
async function checkStageCompletion(
  ctx: DataContext,
  runId: string,
  stageId: string,
  stageName: string,
  flowName: string,
): Promise<void> {
  // Get all steps in this stage
  const stageSteps = await executeSelect(
    ctx.db,
    schema,
    (q, p) =>
      q
        .from("step")
        .where((s) => s.stage_id === p.stageId)
        .select((s) => ({
          id: s.id,
          status: s.status,
        })),
    { stageId },
  );

  // Check if all steps are in terminal state (completed or failed)
  const allComplete = stageSteps.every(
    (s) => s.status === "completed" || s.status === "failed",
  );

  if (!allComplete) {
    logger.debug("Stage still has pending/running steps", {
      stageId,
      stageName,
    });
    return; // Stage not complete yet
  }

  // Check if any step failed
  const anyFailed = stageSteps.some((s) => s.status === "failed");

  if (anyFailed) {
    // Stage failed
    logger.info("Stage failed", { stageId, stageName });

    await updateStage(ctx, stageId, {
      status: "failed",
      completedAt: Date.now(),
    });

    // Call flow with MAXQ_FAILED_STAGE
    logger.info("Calling flow with MAXQ_FAILED_STAGE", {
      runId,
      failedStage: stageName,
    });

    try {
      await executeFlowStageFailed({
        runId,
        flowName,
        flowsRoot: ctx.executor.config.flowsRoot,
        apiUrl: ctx.executor.apiUrl,
        maxLogCapture: ctx.executor.config.maxLogCapture,
        processRegistry: ctx.executor.processRegistry,
        failedStage: stageName,
      });
    } catch (flowError) {
      logger.error("Flow callback failed after stage failure", {
        runId,
        failedStage: stageName,
        error: flowError,
      });
    }

    // Mark run as failed
    await updateRun(ctx, runId, {
      status: "failed",
      completedAt: Date.now(),
    });
  } else {
    // Stage completed successfully
    logger.info("Stage completed successfully", {
      stageId,
      stageName,
    });

    await updateStage(ctx, stageId, {
      status: "completed",
      completedAt: Date.now(),
    });

    // Get stage to check if it's final
    const stages = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("stage").where((s) => s.id === p.stageId),
      { stageId },
    );

    const stage = stages[0];
    if (!stage) {
      logger.error("Stage not found after completion", { stageId });
      return;
    }

    if (stage.final) {
      // Final stage - mark run as completed
      logger.info("Final stage completed, marking run as completed", {
        runId,
      });

      await updateRun(ctx, runId, {
        status: "completed",
        completedAt: Date.now(),
      });
    } else {
      // Non-final stage - call flow with MAXQ_COMPLETED_STAGE
      logger.info("Non-final stage completed, calling flow for next stage", {
        runId,
        completedStage: stageName,
      });

      await executeFlowStageCompleted({
        runId,
        flowName,
        flowsRoot: ctx.executor.config.flowsRoot,
        apiUrl: ctx.executor.apiUrl,
        maxLogCapture: ctx.executor.config.maxLogCapture,
        processRegistry: ctx.executor.processRegistry,
        completedStage: stageName,
      });
    }
  }
}
