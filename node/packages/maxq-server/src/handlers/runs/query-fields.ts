import { Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeSelect } from "@tinqerjs/better-sqlite3-adapter";
import type { DataContext } from "../../domain/data-context.js";

const logger = createLogger("maxq:handlers:runs:query-fields");

// Validation schema for query parameters
const queryFieldsSchema = z.object({
  stepId: z.string().optional(),
  fieldName: z.string().optional(),
});

/**
 * GET /api/v1/runs/:runId/fields - Query step fields
 * Returns fields posted by steps, optionally filtered by step ID or field name
 */
export function queryFieldsHandler(ctx: DataContext) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { runId } = req.params;
      if (!runId) {
        res.status(400).json({ error: "Missing runId parameter" });
        return;
      }

      const params = queryFieldsSchema.parse(req.query);

      logger.debug("Querying step fields", {
        runId,
        stepId: params.stepId,
        fieldName: params.fieldName,
      });

      // Query steps with fields
      const steps = await executeSelect(
        ctx.db,
        schema,
        (q, p) => {
          let query = q.from("step").where((s) => s.run_id === p.runId);

          // Filter by step ID if provided
          if (p.stepId) {
            query = query.where((s) => s.id === p.stepId);
          }

          return query;
        },
        {
          runId,
          stepId: params.stepId ?? null,
        },
      );

      // Map results to response format
      const fields = steps.map((step) => {
        const stepFields = step.fields as Record<string, unknown> | null;

        // If fieldName filter is specified, extract only that field
        let filteredFields = stepFields;
        if (params.fieldName && stepFields) {
          filteredFields = {
            [params.fieldName]: stepFields[params.fieldName],
          };
        }

        return {
          stepId: step.id,
          stepName: step.name,
          stageId: step.stage_id,
          status: step.status,
          fields: filteredFields,
          completedAt: step.completed_at,
        };
      });

      res.status(200).json({ fields });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid query parameters", details: error.errors });
        return;
      }
      logger.error("Failed to query fields", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
