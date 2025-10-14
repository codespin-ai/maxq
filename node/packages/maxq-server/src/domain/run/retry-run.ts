/**
 * Retry a failed or aborted workflow
 * Resets failed/aborted work to pending and restarts execution
 */

import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeSelect, executeUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { DataContext } from "../data-context.js";
import type { Run } from "../../types.js";
import { mapRunFromDb } from "../../mappers.js";
import { createRunLog } from "../run-log/create-run-log.js";
import { startRun } from "../../executor/orchestrator.js";

const logger = createLogger("maxq:domain:run:retry");

/**
 * Retry a failed or aborted workflow
 * Resets failed/aborted work to pending status and restarts execution
 *
 * @param ctx - Data context containing database and executor config
 * @param runId - ID of the run to retry
 * @returns Result containing retried run or an error
 */
export async function retryRun(
  ctx: DataContext,
  runId: string,
): Promise<Result<Run, Error>> {
  try {
    logger.info("Retrying run", { runId });

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

    const run = mapRunFromDb(runRow);

    // Check if run can be retried (must not be completed)
    if (run.status === "completed") {
      return failure(
        new Error(
          `Run cannot be retried: status is '${run.status}' (completed runs cannot be retried)`,
        ),
      );
    }

    // If run is still running, reject with 409 conflict
    // User should abort first, then retry
    if (run.status === "running" && !run.terminationReason) {
      return failure(
        new Error(
          `Run cannot be retried: run is still in progress (status: 'running'). Abort the run first.`,
        ),
      );
    }

    // Create log entry for retry
    await createRunLog(ctx, {
      runId,
      entityType: "run",
      level: "info",
      message: "Run retry initiated",
    });

    // Reset the run to pending
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("run")
          .set({
            status: "pending",
            termination_reason: null,
            completed_at: null,
          })
          .where((r) => r.id === p.runId),
      { runId },
    );

    // Reset all non-completed stages to pending
    // Clear ALL timing fields to remove stale data
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("stage")
          .set({
            status: "pending",
            termination_reason: null,
            started_at: null,
            completed_at: null,
          })
          .where((s) => s.run_id === p.runId && s.status !== "completed"),
      { runId },
    );

    // Reset all non-completed steps to pending
    // Clear ALL timing fields to remove stale data
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
          })
          .where((s) => s.run_id === p.runId && s.status !== "completed"),
      { runId },
    );

    // Get updated run
    const updatedRuns = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("run").where((r) => r.id === p.runId),
      { runId },
    );

    const updatedRun = mapRunFromDb(updatedRuns[0]!);

    logger.info("Run reset to pending, restarting orchestrator", { runId });

    // Restart the orchestrator
    const orchestratorCtx = {
      db: ctx.db,
      config: ctx.executor.config,
      apiUrl: ctx.executor.apiUrl,
      processRegistry: ctx.executor.processRegistry,
    };

    // Start run execution (non-blocking)
    startRun(orchestratorCtx, {
      runId: updatedRun.id,
      flowName: updatedRun.flowName,
    }).catch((error) => {
      logger.error("Orchestrator failed after retry", { runId, error });
    });

    logger.info("Run retried successfully", { runId });

    return success(updatedRun);
  } catch (error) {
    logger.error("Failed to retry run", { error, runId });
    return failure(error as Error);
  }
}
