/**
 * Retry a failed step
 * Resets a specific failed step to pending and optionally cascades to dependent steps
 */

import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeSelect, executeUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { IDatabase } from "pg-promise";
import type { DataContext } from "../data-context.js";
import type { Step } from "../../types.js";
import { mapStepFromDb } from "../../mappers.js";
import { createRunLog } from "../run-log/create-run-log.js";

const logger = createLogger("maxq:domain:step:retry");

export type RetryStepOptions = {
  cascadeDownstream?: boolean; // If true, also retry steps that depend on this one
};

export type RetryStepResult = {
  step: Step;
  cascadedSteps: Step[]; // Steps that were also reset due to cascade
};

/**
 * Find all steps that transitively depend on a given step
 */
async function findDependentSteps(
  db: IDatabase<unknown>,
  runId: string,
  stepId: string,
): Promise<string[]> {
  // Get all steps for this run
  const allSteps = await executeSelect(
    db,
    schema,
    (q, p) => q.from("step").where((s) => s.run_id === p.runId),
    { runId },
  );

  const dependentIds = new Set<string>();
  const toProcess = [stepId];

  while (toProcess.length > 0) {
    const currentId = toProcess.pop()!;

    // Find steps that depend on currentId
    for (const step of allSteps) {
      const dependsOn = (step.depends_on as string[]) || [];
      if (
        dependsOn.includes(currentId) &&
        !dependentIds.has(step.id) &&
        step.id !== stepId
      ) {
        dependentIds.add(step.id);
        toProcess.push(step.id);
      }
    }
  }

  return Array.from(dependentIds);
}

/**
 * Retry a failed step
 * Resets the step to pending status and optionally cascades to dependent steps
 *
 * @param ctx - Data context containing database
 * @param runId - ID of the run containing the step
 * @param stepId - ID of the step to retry
 * @param options - Retry options (cascade behavior)
 * @returns Result containing retried step and cascaded steps, or an error
 */
export async function retryStep(
  ctx: DataContext,
  runId: string,
  stepId: string,
  options: RetryStepOptions = {},
): Promise<Result<RetryStepResult, Error>> {
  const { cascadeDownstream = true } = options;

  try {
    logger.info("Retrying step", { runId, stepId, cascadeDownstream });

    // Get the run
    const runs = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("run").where((r) => r.id === p.runId),
      { runId },
    );

    const runRow = runs[0];
    if (!runRow) {
      return failure(new Error(`Run not found: ${runId}`));
    }

    // Check if run is completed (cannot retry steps in completed runs)
    if (runRow.status === "completed") {
      return failure(
        new Error(
          `Cannot retry step: run is completed (completed runs cannot be modified)`,
        ),
      );
    }

    // Check if run is currently running without termination (must pause/abort first)
    if (runRow.status === "running" && !runRow.termination_reason) {
      return failure(
        new Error(
          `Cannot retry step: run is actively running (pause or abort the run first)`,
        ),
      );
    }

    // Get the step
    const steps = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q.from("step").where((s) => s.run_id === p.runId && s.id === p.stepId),
      { runId, stepId },
    );

    const stepRow = steps[0];
    if (!stepRow) {
      return failure(new Error(`Step not found: ${stepId} in run ${runId}`));
    }

    const step = mapStepFromDb(stepRow);

    // Check if step is failed (only retry failed steps)
    if (step.status !== "failed") {
      return failure(
        new Error(
          `Cannot retry step: status is '${step.status}' (only failed steps can be retried)`,
        ),
      );
    }

    // Find dependent steps if cascading
    let dependentStepIds: string[] = [];
    if (cascadeDownstream) {
      dependentStepIds = await findDependentSteps(ctx.db, runId, stepId);
      logger.info("Found dependent steps for cascade", {
        stepId,
        dependentCount: dependentStepIds.length,
        dependentIds: dependentStepIds,
      });
    }

    // Create log entry for retry
    await createRunLog(ctx, {
      runId,
      entityType: "step",
      entityId: stepId,
      level: "info",
      message: cascadeDownstream
        ? `Step retry initiated (cascading to ${dependentStepIds.length} dependent steps)`
        : "Step retry initiated",
      metadata: {
        cascadeDownstream,
        dependentStepCount: dependentStepIds.length,
      },
    });

    // Reset the step to pending
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("step")
          .set({
            status: "pending",
            termination_reason: null,
            started_at: null,
            completed_at: null,
            duration_ms: null,
            stdout: null,
            stderr: null,
            fields: null,
            error: null,
            retry_count: 0,
            queued_at: null,
            claimed_at: null,
            heartbeat_at: null,
            worker_id: null,
          })
          .where((s) => s.run_id === p.runId && s.id === p.stepId),
      { runId, stepId },
    );

    // Reset dependent steps if cascading
    let cascadedSteps: Step[] = [];
    if (cascadeDownstream && dependentStepIds.length > 0) {
      // Reset dependent steps to pending
      await executeUpdate(
        ctx.db,
        schema,
        (q, p) =>
          q
            .update("step")
            .set({
              status: "pending",
              termination_reason: null,
              started_at: null,
              completed_at: null,
              duration_ms: null,
              stdout: null,
              stderr: null,
              fields: null,
              error: null,
              retry_count: 0,
              queued_at: null,
              claimed_at: null,
              heartbeat_at: null,
              worker_id: null,
            })
            .where((s) => s.run_id === p.runId && p.stepIds.includes(s.id)),
        { runId, stepIds: dependentStepIds },
      );

      // Fetch updated dependent steps
      const cascadedStepRows = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("step")
            .where((s) => s.run_id === p.runId && p.stepIds.includes(s.id)),
        { runId, stepIds: dependentStepIds },
      );

      cascadedSteps = cascadedStepRows.map(mapStepFromDb);
    }

    // If run was failed, set it back to running so scheduler picks up the steps
    if (runRow.status === "failed" || runRow.status === "paused") {
      await executeUpdate(
        ctx.db,
        schema,
        (q, p) =>
          q
            .update("run")
            .set({
              status: "running",
              termination_reason: null,
            })
            .where((r) => r.id === p.runId),
        { runId },
      );

      logger.info("Run status updated to running", { runId });
    }

    // Get updated step
    const updatedSteps = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q.from("step").where((s) => s.run_id === p.runId && s.id === p.stepId),
      { runId, stepId },
    );

    const updatedStep = mapStepFromDb(updatedSteps[0]!);

    logger.info("Step retried successfully", {
      runId,
      stepId,
      cascadedCount: cascadedSteps.length,
    });

    return success({
      step: updatedStep,
      cascadedSteps,
    });
  } catch (error) {
    logger.error("Failed to retry step", { error, runId, stepId });
    return failure(error as Error);
  }
}
