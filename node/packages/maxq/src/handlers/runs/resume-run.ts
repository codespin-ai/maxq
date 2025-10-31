/**
 * Resume run handler
 * POST /api/v1/runs/:runId/resume
 */

import type { Request, Response } from "express";
import { createLogger } from "../../lib/logger/index.js";
import type { DataContext } from "../../domain/data-context.js";
import { resumeRun } from "../../domain/run/resume-run.js";

const logger = createLogger("maxq:handlers:runs:resume");

/**
 * POST /api/v1/runs/:runId/resume - Resume a paused workflow
 * Restarts execution of a paused workflow
 */
export function resumeRunHandler(ctx: DataContext) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { runId } = req.params;
      if (!runId) {
        res.status(400).json({ error: "Missing runId parameter" });
        return;
      }

      logger.info("Resuming run", { runId });

      const result = await resumeRun(ctx, runId);

      if (!result.success) {
        if (result.error.message.includes("not found")) {
          res.status(404).json({ error: result.error.message });
          return;
        }
        if (result.error.message.includes("cannot be resumed")) {
          res.status(400).json({ error: result.error.message });
          return;
        }
        logger.error("Failed to resume run", { runId, error: result.error });
        res.status(500).json({ error: "Failed to resume run" });
        return;
      }

      res.status(200).json({
        run: result.data,
        message: "Run resumed successfully",
      });
    } catch (error) {
      logger.error("Failed to resume run", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
