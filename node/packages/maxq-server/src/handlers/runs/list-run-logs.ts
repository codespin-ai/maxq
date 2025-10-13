/**
 * List run logs handler
 * GET /api/v1/runs/:runId/logs
 */

import type { Request, Response } from "express";
import { createLogger } from "@codespin/maxq-logger";
import type { DataContext } from "../../domain/data-context.js";
import { listRunLogs } from "../../domain/run-log/list-run-logs.js";

const logger = createLogger("maxq:handlers:runs:list-run-logs");

/**
 * GET /api/v1/runs/:runId/logs - List run logs with filtering
 * Query parameters:
 * - entityType: Filter by entity type (run|stage|step)
 * - entityId: Filter by specific entity ID
 * - level: Filter by log level (debug|info|warn|error)
 * - limit: Max number of logs to return (default: 100)
 * - before: Return logs before this timestamp
 * - after: Return logs after this timestamp
 */
export function listRunLogsHandler(ctx: DataContext) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { runId } = req.params;
      if (!runId) {
        res.status(400).json({ error: "Missing runId parameter" });
        return;
      }

      // Parse query parameters
      const entityType = req.query.entityType as
        | "run"
        | "stage"
        | "step"
        | undefined;
      const entityId = req.query.entityId as string | undefined;
      const level = req.query.level as
        | "debug"
        | "info"
        | "warn"
        | "error"
        | undefined;
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 100;
      const before = req.query.before
        ? parseInt(req.query.before as string, 10)
        : undefined;
      const after = req.query.after
        ? parseInt(req.query.after as string, 10)
        : undefined;

      logger.debug("Listing run logs", {
        runId,
        entityType,
        entityId,
        level,
        limit,
        before,
        after,
      });

      const result = await listRunLogs(ctx, {
        runId,
        entityType,
        entityId,
        level,
        limit,
        before,
        after,
      });

      if (!result.success) {
        logger.error("Failed to list run logs", {
          runId,
          error: result.error,
        });
        res.status(500).json({ error: "Failed to list run logs" });
        return;
      }

      const logs = result.data;

      res.status(200).json({
        logs,
        count: logs.length,
      });
    } catch (error) {
      logger.error("Failed to list run logs", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
