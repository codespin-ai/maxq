import { Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "../../lib/logger/index.js";
import type { DataContext } from "../../domain/data-context.js";
import { updateRun } from "../../domain/run/update-run.js";

const logger = createLogger("maxq:handlers:runs:update");

// Validation schema
// Note: stdout/stderr are NOT accepted from external clients
// They are captured internally by MaxQ when spawning processes
export const updateRunSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  output: z.unknown().optional(),
  error: z.unknown().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
});

/**
 * PATCH /api/v1/runs/:id - Update a run
 */
export function updateRunHandler(ctx: DataContext) {
  return async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: "Run ID is required" });
        return;
      }

      const input = updateRunSchema.parse(req.body);
      const result = await updateRun(ctx, id, input);

      if (!result.success) {
        logger.warn("Failed to update run", {
          error: result.error.message,
          id,
        });
        res.status(400).json({ error: result.error.message });
        return;
      }

      res.json(result.data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid request", details: error.errors });
        return;
      }
      logger.error("Error updating run", { error, id: req.params.id });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
