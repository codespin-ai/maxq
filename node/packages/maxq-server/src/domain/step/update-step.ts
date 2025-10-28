import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeUpdate, executeSelect } from "@tinqerjs/pg-promise-adapter";
import type { DataContext } from "../data-context.js";
import type { Step, UpdateStepInput } from "../../types.js";
import { mapStepFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:step");

/**
 * Update an existing step
 *
 * @param ctx - Data context containing database connection
 * @param id - Step ID to update
 * @param input - Step update parameters
 * @returns Result containing the updated step or an error
 */
export async function updateStep(
  ctx: DataContext,
  id: string,
  input: UpdateStepInput,
): Promise<Result<Step, Error>> {
  try {
    if (Object.keys(input).length === 0) {
      return failure(new Error("No fields to update"));
    }

    // Fetch current row to get existing values
    const existingRows = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("step").where((s) => s.id === p.id),
      { id },
    );

    const existing = existingRows[0];
    if (!existing) {
      return failure(new Error("Step not found"));
    }

    // Update with object literal - all values passed via params
    const rows = await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("step")
          .set({
            status: p.status,
            fields: p.fields,
            error: p.error,
            retry_count: p.retryCount,
            started_at: p.startedAt,
            completed_at: p.completedAt,
            stdout: p.stdout,
            stderr: p.stderr,
          })
          .where((s) => s.id === p.id)
          .returning((s) => s),
      {
        id,
        status: input.status ?? existing.status,
        fields: input.fields ?? existing.fields,
        error: input.error ?? existing.error,
        retryCount: input.retryCount ?? existing.retry_count,
        startedAt: input.startedAt ?? existing.started_at,
        completedAt: input.completedAt ?? existing.completed_at,
        stdout: input.stdout ?? existing.stdout,
        stderr: input.stderr ?? existing.stderr,
      },
    );

    const row = rows[0];
    if (!row) {
      return failure(new Error("Step not found after update"));
    }

    logger.debug("Updated step", { id, updates: Object.keys(input) });

    return success(mapStepFromDb(row));
  } catch (error) {
    logger.error("Failed to update step", { error, id, input });
    return failure(error as Error);
  }
}
