/**
 * Retry run handler
 * POST /api/v1/runs/:runId/retry
 */

import type { Request, Response } from "express";
import { createLogger } from "../../lib/logger/index.js";
import type { DataContext } from "../../domain/data-context.js";
import { retryRun } from "../../domain/run/retry-run.js";

const logger = createLogger("maxq:handlers:runs:retry");

/**
 * POST /api/v1/runs/:runId/retry - Retry a failed or aborted workflow
 * Resets failed/aborted work to pending and restarts execution
 */
export function retryRunHandler(ctx: DataContext) {
  return async (
    req: Request<{ runId: string }>,
    res: Response,
  ): Promise<void> => {
    try {
      const { runId } = req.params;
      if (!runId) {
        res.status(400).json({ error: "Missing runId parameter" });
        return;
      }

      logger.info("Retrying run", { runId });

      const result = await retryRun(ctx, runId);

      if (!result.success) {
        if (result.error.message.includes("not found")) {
          res.status(404).json({ error: result.error.message });
          return;
        }
        if (result.error.message.includes("still in progress")) {
          res.status(409).json({ error: result.error.message });
          return;
        }
        if (result.error.message.includes("cannot be retried")) {
          res.status(400).json({ error: result.error.message });
          return;
        }
        logger.error("Failed to retry run", { runId, error: result.error });
        res.status(500).json({ error: "Failed to retry run" });
        return;
      }

      const run = result.data;

      res.status(200).json({
        run,
        message: "Run retry initiated",
      });
    } catch (error) {
      logger.error("Failed to retry run", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
