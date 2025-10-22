/**
 * Resume a paused workflow
 * Restarts execution of a paused workflow from where it left off
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
 * Resume a paused workflow
 * Changes run status from paused to running/pending and restarts execution
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

    // Check if run is paused
    if (run.status !== "paused") {
      return failure(
        new Error(
          `Run cannot be resumed: status is '${run.status}' (only paused runs can be resumed)`,
        ),
      );
    }

    // Create log entry for resume
    await createRunLog(ctx, {
      runId,
      entityType: "run",
      level: "info",
      message: "Run resume initiated",
    });

    // Set the run back to pending (orchestrator will set to running)
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("run")
          .set({
            status: "pending",
          })
          .where((r) => r.id === p.runId),
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

    logger.info("Run set to pending, restarting orchestrator", { runId });

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
      logger.error("Orchestrator failed after resume", { runId, error });
    });

    logger.info("Run resumed successfully", { runId });

    return success(updatedRun);
  } catch (error) {
    logger.error("Failed to resume run", { error, runId });
    return failure(error as Error);
  }
}
