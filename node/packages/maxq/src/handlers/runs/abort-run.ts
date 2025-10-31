/**
 * Abort run handler
 * POST /api/v1/runs/:runId/abort
 */

import type { Request, Response } from "express";
import { createLogger } from "../../lib/logger/index.js";
import type { DataContext } from "../../domain/data-context.js";
import { abortRun } from "../../domain/run/abort-run.js";

const logger = createLogger("maxq:handlers:runs:abort");

/**
 * POST /api/v1/runs/:runId/abort - Abort a running workflow
 * Kills all running processes and marks incomplete work as failed
 */
export function abortRunHandler(ctx: DataContext, abortGraceMs: number) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { runId } = req.params;
      if (!runId) {
        res.status(400).json({ error: "Missing runId parameter" });
        return;
      }

      logger.info("Aborting run", { runId });

      const result = await abortRun(ctx, runId, abortGraceMs);

      if (!result.success) {
        if (result.error.message.includes("not found")) {
          res.status(404).json({ error: result.error.message });
          return;
        }
        logger.error("Failed to abort run", { runId, error: result.error });
        res.status(500).json({ error: "Failed to abort run" });
        return;
      }

      const { run, alreadyCompleted, processesKilled } = result.data;

      if (alreadyCompleted) {
        res.status(400).json({
          error: `Cannot abort run: already ${run.status}`,
        });
        return;
      }

      res.status(200).json({
        message: "Run aborted successfully",
        processesKilled,
      });
    } catch (error) {
      logger.error("Failed to abort run", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
