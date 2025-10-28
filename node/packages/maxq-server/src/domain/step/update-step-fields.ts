import { Result, failure, success } from "@codespin/maxq-core";
import type { DataContext } from "../data-context.js";
import type { Step } from "../../types.js";
import { schema } from "@codespin/maxq-db";
import { executeUpdate as executeUpdatePg } from "@tinqerjs/pg-promise-adapter";
import { mapStepFromDb } from "../../mappers.js";

/**
 * Update step with fields posted by step.sh
 * Fields are arbitrary JSON data - this does NOT affect step status
 * Exit codes are the ONLY source of truth for step status
 */
export async function updateStepFields(
  ctx: DataContext,
  runId: string,
  stepId: string,
  fields: Record<string, unknown>,
): Promise<Result<Step, Error>> {
  try {
    const now = Date.now();

    // Update step with fields only - DO NOT touch status
    // Status is determined solely by exit code via the executor
    const rows = await executeUpdatePg(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("step")
          .set({
            fields: p.fields,
            completed_at: p.completedAt,
          })
          .where((s) => s.run_id === p.runId && s.id === p.stepId)
          .returning((s) => s),
      {
        fields: JSON.stringify(fields), // Must stringify for JSONB column
        completedAt: now,
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
