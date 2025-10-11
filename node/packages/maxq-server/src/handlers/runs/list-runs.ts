import { Request, Response } from "express";
import { createLogger } from "@codespin/maxq-logger";
import type { DataContext } from "../../domain/data-context.js";
import { listRuns } from "../../domain/run/list-runs.js";
import type { RunStatus } from "@codespin/maxq-db";

const logger = createLogger("maxq:handlers:runs:list");

/**
 * GET /api/v1/runs - List runs with pagination
 */
export function listRunsHandler(ctx: DataContext) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const params = {
        flowName: req.query.flowName as string | undefined,
        status: req.query.status as RunStatus | undefined,
        limit: req.query.limit
          ? parseInt(req.query.limit as string)
          : undefined,
        offset: req.query.offset
          ? parseInt(req.query.offset as string)
          : undefined,
        sortBy: req.query.sortBy as "createdAt" | "completedAt" | undefined,
        sortOrder: req.query.sortOrder as "asc" | "desc" | undefined,
      };

      const result = await listRuns(ctx, params);

      if (!result.success) {
        logger.warn("Failed to list runs", { error: result.error.message });
        res.status(500).json({ error: result.error.message });
        return;
      }

      res.json(result.data);
    } catch (error) {
      logger.error("Error listing runs", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
