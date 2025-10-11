import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import type { StageDbRow } from "@codespin/maxq-db";
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
    const updates: string[] = [];
    const params: Record<string, unknown> = { id };

    if (input.status !== undefined) {
      updates.push("status = ${status}");
      params.status = input.status;
    }
    if (input.completedAt !== undefined) {
      updates.push("completed_at = ${completedAt}");
      params.completedAt = input.completedAt;
    }

    if (updates.length === 0) {
      return failure(new Error("No fields to update"));
    }

    const updateQuery = `
      UPDATE stage
      SET ${updates.join(", ")}
      WHERE id = \${id}
      RETURNING *
    `;

    const row = await ctx.db.one<StageDbRow>(updateQuery, params);

    logger.debug("Updated stage", { id, updates: Object.keys(input) });

    return success(mapStageFromDb(row));
  } catch (error) {
    logger.error("Failed to update stage", { error, id, input });
    return failure(error as Error);
  }
}
