import { Request, Response } from "express";
import { createLogger } from "../../lib/logger/index.js";
import type { DataContext } from "../../domain/data-context.js";
import { getRun } from "../../domain/run/get-run.js";

const logger = createLogger("maxq:handlers:runs:get");

/**
 * GET /api/v1/runs/:id - Get a run by ID
 */
export function getRunHandler(ctx: DataContext) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: "Run ID is required" });
        return;
      }

      const result = await getRun(ctx, id);

      if (!result.success) {
        logger.warn("Failed to get run", { error: result.error.message, id });
        res.status(500).json({ error: result.error.message });
        return;
      }

      if (!result.data) {
        res.status(404).json({ error: "Run not found" });
        return;
      }

      res.json(result.data);
    } catch (error) {
      logger.error("Error getting run", { error, id: req.params.id });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
