/**
 * Retry step handler
 * POST /api/v1/runs/:runId/steps/:stepId/retry
 */

import type { Request, Response } from "express";
import { createLogger } from "@codespin/maxq-logger";
import { z } from "zod";
import type { DataContext } from "../../domain/data-context.js";
import { retryStep } from "../../domain/step/retry-step.js";

const logger = createLogger("maxq:handlers:runs:retry-step");

// Request body schema
const retryStepSchema = z.object({
  cascadeDownstream: z.boolean().optional().default(true),
});

/**
 * POST /api/v1/runs/:runId/steps/:stepId/retry - Retry a failed step
 * Resets a failed step to pending and optionally cascades to dependent steps
 */
export function retryStepHandler(ctx: DataContext) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { runId, stepId } = req.params;
      if (!runId) {
        res.status(400).json({ error: "Missing runId parameter" });
        return;
      }
      if (!stepId) {
        res.status(400).json({ error: "Missing stepId parameter" });
        return;
      }

      // Parse and validate request body
      const parseResult = retryStepSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        res.status(400).json({
          error: "Invalid request body",
          details: parseResult.error.errors,
        });
        return;
      }

      const { cascadeDownstream } = parseResult.data;

      logger.info("Retrying step", { runId, stepId, cascadeDownstream });

      const result = await retryStep(ctx, runId, stepId, { cascadeDownstream });

      if (!result.success) {
        if (result.error.message.includes("not found")) {
          res.status(404).json({ error: result.error.message });
          return;
        }
        if (
          result.error.message.includes("cannot retry") ||
          result.error.message.includes("Cannot retry")
        ) {
          res.status(400).json({ error: result.error.message });
          return;
        }
        logger.error("Failed to retry step", {
          runId,
          stepId,
          error: result.error,
        });
        res.status(500).json({ error: "Failed to retry step" });
        return;
      }

      const { step, cascadedSteps } = result.data;

      res.status(200).json({
        step,
        cascadedSteps,
        message: `Step retried successfully${cascadedSteps.length > 0 ? ` (${cascadedSteps.length} dependent steps also reset)` : ""}`,
      });
    } catch (error) {
      logger.error("Failed to retry step", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
