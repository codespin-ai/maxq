import { Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "../../lib/logger/index.js";
import type { DataContext } from "../../domain/data-context.js";
import { createRun } from "../../domain/run/create-run.js";
import { startRun } from "../../executor/orchestrator.js";
import { getFlow } from "../../executor/flow-discovery.js";

const logger = createLogger("maxq:handlers:runs:create");

// Validation schema
export const createRunSchema = z.object({
  flowName: z.string().min(1),
  input: z.unknown().optional(),
  metadata: z.unknown().optional(),
});

/**
 * POST /api/v1/runs - Create a new run
 */
export function createRunHandler(ctx: DataContext) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const input = createRunSchema.parse(req.body);

      // Get flow metadata (including title from flow.yaml if present)
      const flow = await getFlow(ctx.executor.config.flowsRoot, input.flowName);

      const result = await createRun(ctx, {
        flowName: input.flowName,
        input: input.input,
        metadata: input.metadata,
        flowTitle: flow?.title,
      });

      if (!result.success) {
        res.status(400).json({ error: result.error.message });
        return;
      }

      const run = result.data;

      // Start workflow execution asynchronously
      // Don't wait for completion - workflow runs in background
      startRun(
        {
          db: ctx.db,
          config: ctx.executor.config,
          apiUrl: ctx.executor.apiUrl,
          processRegistry: ctx.executor.processRegistry,
        },
        {
          runId: run.id,
          flowName: run.flowName,
        },
      ).catch((error) => {
        logger.error("Workflow execution failed", {
          runId: run.id,
          flowName: run.flowName,
          error,
        });
      });

      res.status(201).json(run);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid request", details: error.errors });
        return;
      }
      logger.error("Failed to create run", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
