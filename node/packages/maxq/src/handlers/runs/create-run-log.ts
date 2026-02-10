/**
 * Create run log handler
 * POST /api/v1/runs/:runId/logs
 */

import type { Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "../../lib/logger/index.js";
import type { DataContext } from "../../domain/data-context.js";
import { createRunLog } from "../../domain/run-log/create-run-log.js";

const logger = createLogger("maxq:handlers:runs:create-run-log");

// Validation schema
const createRunLogSchema = z.object({
  entityType: z.enum(["run", "stage", "step"]),
  entityId: z.string().optional(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string().min(1),
  metadata: z.unknown().optional(),
});

/**
 * POST /api/v1/runs/:runId/logs - Create a run log entry
 * Allows recording structured log messages for runs, stages, and steps
 */
export function createRunLogHandler(ctx: DataContext) {
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

      const input = createRunLogSchema.parse(req.body);

      logger.debug("Creating run log", { runId, ...input });

      const result = await createRunLog(ctx, {
        runId,
        ...input,
      });

      if (!result.success) {
        logger.error("Failed to create run log", {
          runId,
          error: result.error,
        });
        res.status(500).json({ error: "Failed to create run log" });
        return;
      }

      const log = result.data;

      res.status(201).json(log);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid request", details: error.errors });
        return;
      }
      logger.error("Failed to create run log", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
