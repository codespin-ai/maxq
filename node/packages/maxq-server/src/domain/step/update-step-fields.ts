import { Result, failure, success } from "@codespin/maxq-core";
import type { DataContext } from "../data-context.js";
import type { Step } from "../../types.js";
import { schema } from "@codespin/maxq-db";
import { executeUpdate as executeUpdatePg } from "@webpods/tinqer-sql-pg-promise";
import { mapStepFromDb } from "../../mappers.js";

/**
 * Update step with fields posted by step.sh
 * This marks the step as completed
 */
export async function updateStepFields(
  ctx: DataContext,
  runId: string,
  stepId: string,
  fields: Record<string, unknown>,
): Promise<Result<Step, Error>> {
  try {
    const now = Date.now();

    // Determine status based on fields
    const status =
      typeof fields.status === "string" && fields.status === "failed"
        ? ("failed" as const)
        : ("completed" as const);

    // Update step with fields and mark as completed
    const rows = await executeUpdatePg(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("step")
          .set({
            fields: p.fields,
            status: p.status,
            completed_at: p.completedAt,
            duration_ms: p.durationMs,
          })
          .where((s) => s.run_id === p.runId && s.id === p.stepId)
          .returning((s) => s),
      {
        fields: JSON.stringify(fields),
        status,
        completedAt: now,
        durationMs: null, // Will be calculated if needed
        runId,
        stepId,
      },
    );

    const row = rows[0];
    if (!row) {
      return failure(
        new Error(`Step not found: runId=${runId}, stepId=${stepId}`),
      );
    }

    const step = mapStepFromDb(row);
    return success(step);
  } catch (error) {
    return failure(error as Error);
  }
}
