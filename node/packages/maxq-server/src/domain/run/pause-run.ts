/**
 * Pause a running workflow
 * Kills all running processes and marks incomplete work as paused
 * Unlike abort, paused workflows can be resumed without retrying completed work
 */

import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeSelect, executeUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { DataContext } from "../data-context.js";
import type { Run } from "../../types.js";
import { mapRunFromDb } from "../../mappers.js";
import { createRunLog } from "../run-log/create-run-log.js";

const logger = createLogger("maxq:domain:run:pause");

/**
 * Pause result containing information about the pause operation
 */
export type PauseRunResult = {
  run: Run;
  alreadyCompleted: boolean;
  processesKilled: number;
};

/**
 * Pause a running workflow
 * Terminates all running processes and marks the run as paused
 *
 * @param ctx - Data context containing database and process registry
 * @param runId - ID of the run to pause
 * @param graceMs - Grace period in milliseconds before escalating to SIGKILL
 * @returns Result containing pause information or an error
 */
export async function pauseRun(
  ctx: DataContext,
  runId: string,
  graceMs: number = 5000,
): Promise<Result<PauseRunResult, Error>> {
  try {
    logger.info("Pausing run", { runId, graceMs });

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
      logger.info("Run already completed or failed, cannot pause", {
        runId,
        status: run.status,
      });

      await createRunLog(ctx, {
        runId,
        entityType: "run",
        level: "warn",
        message: `Pause requested but run already ${run.status}`,
        metadata: { status: run.status },
      });

      return success({
        run,
        alreadyCompleted: true,
        processesKilled: 0,
      });
    }

    // Check if run is already paused
    if (run.status === "paused") {
      logger.info("Run already paused", { runId });

      await createRunLog(ctx, {
        runId,
        entityType: "run",
        level: "info",
        message: "Pause requested but run already paused",
        metadata: { status: run.status },
      });

      return success({
        run,
        alreadyCompleted: true,
        processesKilled: 0,
      });
    }

    // Get process count BEFORE killing them
    const processCount =
      ctx.executor.processRegistry.getProcessesForRun(runId).length;

    // Kill all running processes for this run
    logger.info("Killing processes for run", { runId, processCount });
    await ctx.executor.processRegistry.killProcessesForRun(runId, graceMs);

    // Create log entry for pause
    await createRunLog(ctx, {
      runId,
      entityType: "run",
      level: "info",
      message: "Run paused by user request",
      metadata: { processesKilled: processCount, graceMs },
    });

    // Mark the run as paused
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("run")
          .set({
            status: "paused",
          })
          .where((r) => r.id === p.runId),
      {
        runId,
      },
    );

    // Set all pending/running steps to pending with cleared queue fields
    // This ensures they can be picked up again when resumed
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("step")
          .set({
            status: "pending",
            queued_at: null,
            claimed_at: null,
            heartbeat_at: null,
            worker_id: null,
            started_at: null,
          })
          .where(
            (s) =>
              s.run_id === p.runId &&
              (s.status === "pending" || s.status === "running"),
          ),
      {
        runId,
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

    logger.info("Run paused successfully", {
      runId,
      processesKilled: processCount,
    });

    return success({
      run: updatedRun,
      alreadyCompleted: false,
      processesKilled: processCount,
    });
  } catch (error) {
    logger.error("Failed to pause run", { error, runId });
    return failure(error as Error);
  }
}
