import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { type RunDbRow } from "@codespin/maxq-db";
import type { DataContext } from "../data-context.js";
import type { Run, UpdateRunInput } from "../../types.js";
import { mapRunFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:run");

/**
 * Update a run
 *
 * @param ctx - Data context containing database connection
 * @param id - Run ID
 * @param input - Update parameters
 * @returns Result containing the updated run or an error
 */
export async function updateRun(
  ctx: DataContext,
  id: string,
  input: UpdateRunInput,
): Promise<Result<Run, Error>> {
  try {
    // Build SET clause dynamically
    const updates: string[] = [];
    const params: Record<string, unknown> = { id };

    if (input.status !== undefined) {
      updates.push("status = ${status}");
      params.status = input.status;
    }
    if (input.output !== undefined) {
      updates.push("output = ${output}");
      params.output = input.output;
    }
    if (input.error !== undefined) {
      updates.push("error = ${error}");
      params.error = input.error;
    }
    if (input.startedAt !== undefined) {
      updates.push("started_at = ${startedAt}");
      params.startedAt = input.startedAt;
    }
    if (input.completedAt !== undefined) {
      updates.push("completed_at = ${completedAt}");
      params.completedAt = input.completedAt;
    }

    // Calculate duration if both started and completed times are present
    if (input.startedAt && input.completedAt) {
      updates.push("duration_ms = ${durationMs}");
      params.durationMs = input.completedAt - input.startedAt;
    }

    if (updates.length === 0) {
      return failure(new Error("No fields to update"));
    }

    const sql = `UPDATE run SET ${updates.join(", ")} WHERE id = \${id} RETURNING *`;
    const row = await ctx.db.oneOrNone<RunDbRow>(sql, params);

    if (!row) {
      return failure(new Error("Run not found"));
    }

    logger.info("Updated run", { id, updates: Object.keys(input) });

    return success(mapRunFromDb(row));
  } catch (error) {
    logger.error("Failed to update run", { error, id, input });
    return failure(error as Error);
  }
}
