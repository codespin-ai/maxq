/**
 * Resume an aborted workflow
 * Resets aborted work to pending and restarts execution
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

const logger = createLogger("maxq:domain:run:resume");

/**
 * Resume an aborted workflow
 * Resets aborted work to pending status and restarts execution
 *
 * @param ctx - Data context containing database and executor config
 * @param runId - ID of the run to resume
 * @returns Result containing resumed run or an error
 */
export async function resumeRun(
  ctx: DataContext,
  runId: string,
): Promise<Result<Run, Error>> {
  try {
    logger.info("Resuming run", { runId });

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

    // Check if run can be resumed (must be failed with termination_reason='aborted')
    if (run.status !== "failed") {
      return failure(
        new Error(
          `Run cannot be resumed: status is ${run.status} (must be 'failed')`,
        ),
      );
    }

    if (run.terminationReason !== "aborted") {
      return failure(
        new Error(
          `Run cannot be resumed: termination reason is ${run.terminationReason || "none"} (must be 'aborted')`,
        ),
      );
    }

    // Create log entry for resume
    await createRunLog(ctx, {
      runId,
      entityType: "run",
      level: "info",
      message: "Run resumed after abort",
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

    // Reset all failed stages with termination_reason='aborted' to pending
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("stage")
          .set({
            status: "pending",
            termination_reason: null,
            completed_at: null,
          })
          .where(
            (s) =>
              s.run_id === p.runId &&
              s.status === "failed" &&
              s.termination_reason === "aborted",
          ),
      { runId },
    );

    // Reset all failed steps with termination_reason='aborted' to pending
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("step")
          .set({
            status: "pending",
            termination_reason: null,
            completed_at: null,
            stdout: null,
            stderr: null,
            retry_count: 0,
          })
          .where(
            (s) =>
              s.run_id === p.runId &&
              s.status === "failed" &&
              s.termination_reason === "aborted",
          ),
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
    };

    // Start run execution (non-blocking)
    startRun(orchestratorCtx, {
      runId: updatedRun.id,
      flowName: updatedRun.flowName,
    }).catch((error) => {
      logger.error("Orchestrator failed after resume", { runId, error });
    });

    logger.info("Run resumed successfully", { runId });

    return success(updatedRun);
  } catch (error) {
    logger.error("Failed to resume run", { error, runId });
    return failure(error as Error);
  }
}
