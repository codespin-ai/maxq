import { Request, Response } from "express";
import { z } from "zod";
import type { DataContext } from "../../domain/data-context.js";
import { updateStepFields } from "../../domain/step/update-step-fields.js";

// Validation schema for step fields
const postStepFieldsSchema = z.object({
  fields: z.record(z.unknown()), // Arbitrary key-value pairs
});

/**
 * POST /runs/:runId/steps/:stepId/fields
 *
 * Called by step.sh to post fields and signal completion.
 * The HTTP POST itself signals that step execution has finished.
 */
export function postStepFieldsHandler(ctx: DataContext) {
  return async (
    req: Request<{ runId: string; stepId: string }>,
    res: Response,
  ): Promise<void> => {
    try {
      const { runId, stepId } = req.params;

      if (!runId || !stepId) {
        res.status(400).json({ error: "Missing runId or stepId" });
        return;
      }

      // Validate request body
      const input = postStepFieldsSchema.parse(req.body);

      // Update step with fields
      const result = await updateStepFields(ctx, runId, stepId, input.fields);

      if (!result.success) {
        res.status(400).json({ error: result.error.message });
        return;
      }

      // Return updated step info
      res.status(200).json({
        id: result.data.id,
        runId: result.data.runId,
        fields: result.data.fields,
        completedAt: result.data.completedAt,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid request",
          details: error.errors,
        });
        return;
      }

      res.status(500).json({
        error: "Internal server error",
      });
    }
  };
}
