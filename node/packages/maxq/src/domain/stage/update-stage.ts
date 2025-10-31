import { Result, success, failure } from "../../lib/core/index.js";
import { createLogger } from "../../lib/logger/index.js";
import { schema } from "../../lib/db/index.js";
import { executeUpdate, executeSelect } from "@tinqerjs/better-sqlite3-adapter";
import type { DataContext } from "../data-context.js";
import type { Stage, UpdateStageInput } from "../../types.js";
import { mapStageFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:stage");

/**
 * Update an existing stage
 *
 * @param ctx - Data context containing database connection
 * @param id - Stage ID to update
 * @param input - Stage update parameters
 * @returns Result containing the updated stage or an error
 */
export async function updateStage(
  ctx: DataContext,
  id: string,
  input: UpdateStageInput,
): Promise<Result<Stage, Error>> {
  try {
    if (Object.keys(input).length === 0) {
      return failure(new Error("No fields to update"));
    }

    // Fetch current row to get existing values
    const existingRows = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("stage").where((s) => s.id === p.id),
      { id },
    );

    const existing = existingRows[0];
    if (!existing) {
      return failure(new Error("Stage not found"));
    }

    // Update with object literal - all values passed via params
    // SQLite executeUpdate returns row count, not data
    const rowCount = executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("stage")
          .set({
            status: p.status,
            completed_at: p.completedAt,
          })
          .where((s) => s.id === p.id),
      {
        id,
        status: input.status ?? existing.status,
        completedAt: input.completedAt ?? existing.completed_at,
      },
    );

    if (rowCount === 0) {
      return failure(new Error("Stage not found"));
    }

    // Follow-up SELECT to get the updated row
    const updatedRows = executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("stage").where((s) => s.id === p.id),
      { id },
    );

    const row = updatedRows[0];
    if (!row) {
      return failure(new Error("Stage not found after update"));
    }

    logger.debug("Updated stage", { id, updates: Object.keys(input) });

    return success(mapStageFromDb(row));
  } catch (error) {
    logger.error("Failed to update stage", { error, id, input });
    return failure(error as Error);
  }
}
