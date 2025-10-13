/**
 * Abort a running workflow
 * Kills all running processes and marks incomplete work as failed
 */

import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeSelect, executeUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { DataContext } from "../data-context.js";
import type { Run } from "../../types.js";
import { mapRunFromDb } from "../../mappers.js";
import { createRunLog } from "../run-log/create-run-log.js";

const logger = createLogger("maxq:domain:run:abort");

/**
 * Abort result containing information about the abort operation
 */
export type AbortRunResult = {
  run: Run;
  alreadyCompleted: boolean;
  processesKilled: number;
};

/**
 * Abort a running workflow
 * Terminates all running processes and marks incomplete work as failed
 *
 * @param ctx - Data context containing database and process registry
 * @param runId - ID of the run to abort
 * @param graceMs - Grace period in milliseconds before escalating to SIGKILL
 * @returns Result containing abort information or an error
 */
export async function abortRun(
  ctx: DataContext,
  runId: string,
  graceMs: number = 5000,
): Promise<Result<AbortRunResult, Error>> {
  try {
    logger.info("Aborting run", { runId, graceMs });

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

    // Check if run is already completed or failed
    if (run.status === "completed" || run.status === "failed") {
      logger.info("Run already completed or failed", {
        runId,
        status: run.status,
        terminationReason: run.terminationReason,
      });

      // Create log entry for attempted abort
      await createRunLog(ctx, {
        runId,
        entityType: "run",
        level: "info",
        message: `Abort requested but run already ${run.status}${run.terminationReason ? ` (${run.terminationReason})` : ""}`,
        metadata: {
          status: run.status,
          terminationReason: run.terminationReason,
        },
      });

      return success({
        run,
        alreadyCompleted: true,
        processesKilled: 0,
      });
    }

    // Kill all running processes for this run
    logger.info("Killing processes for run", { runId });
    await ctx.executor.processRegistry.killProcessesForRun(runId, graceMs);

    const processCount =
      ctx.executor.processRegistry.getProcessesForRun(runId).length;

    // Create log entry for abort
    await createRunLog(ctx, {
      runId,
      entityType: "run",
      level: "info",
      message: "Run aborted by user request",
      metadata: { processesKilled: processCount, graceMs },
    });

    const now = Date.now();
    const terminationReason = "aborted";

    // Fail the run
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("run")
          .set({
            status: "failed",
            termination_reason: p.terminationReason,
            completed_at: p.completedAt,
          })
          .where((r) => r.id === p.runId),
      {
        runId,
        terminationReason,
        completedAt: now,
      },
    );

    // Fail all pending/running stages for this run
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("stage")
          .set({
            status: "failed",
            termination_reason: p.terminationReason,
            completed_at: p.completedAt,
          })
          .where(
            (s) =>
              s.run_id === p.runId &&
              (s.status === "pending" || s.status === "running"),
          ),
      {
        runId,
        terminationReason,
        completedAt: now,
      },
    );

    // Fail all pending/running steps for this run
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("step")
          .set({
            status: "failed",
            termination_reason: p.terminationReason,
            completed_at: p.completedAt,
          })
          .where(
            (s) =>
              s.run_id === p.runId &&
              (s.status === "pending" || s.status === "running"),
          ),
      {
        runId,
        terminationReason,
        completedAt: now,
      },
    );

    // Get updated run
    const updatedRuns = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("run").where((r) => r.id === p.runId),
      { runId },
    );

    const updatedRun = mapRunFromDb(updatedRuns[0]!);

    logger.info("Run aborted successfully", {
      runId,
      processesKilled: processCount,
    });

    return success({
      run: updatedRun,
      alreadyCompleted: false,
      processesKilled: processCount,
    });
  } catch (error) {
    logger.error("Failed to abort run", { error, runId });
    return failure(error as Error);
  }
}
