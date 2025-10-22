/**
 * Pause run handler
 * POST /api/v1/runs/:runId/pause
 */

import type { Request, Response } from "express";
import { createLogger } from "@codespin/maxq-logger";
import type { DataContext } from "../../domain/data-context.js";
import { pauseRun } from "../../domain/run/pause-run.js";

const logger = createLogger("maxq:handlers:runs:pause");

/**
 * POST /api/v1/runs/:runId/pause - Pause a running workflow
 * Kills all running processes and marks run as paused
 */
export function pauseRunHandler(ctx: DataContext, pauseGraceMs: number) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { runId } = req.params;
      if (!runId) {
        res.status(400).json({ error: "Missing runId parameter" });
        return;
      }

      logger.info("Pausing run", { runId });

      const result = await pauseRun(ctx, runId, pauseGraceMs);

      if (!result.success) {
        if (result.error.message.includes("not found")) {
          res.status(404).json({ error: result.error.message });
          return;
        }
        logger.error("Failed to pause run", { runId, error: result.error });
        res.status(500).json({ error: "Failed to pause run" });
        return;
      }

      const { run, alreadyCompleted, processesKilled } = result.data;

      if (alreadyCompleted) {
        res.status(400).json({
          error: `Cannot pause run: already ${run.status}`,
        });
        return;
      }

      res.status(200).json({
        message: "Run paused successfully",
        processesKilled,
      });
    } catch (error) {
      logger.error("Failed to pause run", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
